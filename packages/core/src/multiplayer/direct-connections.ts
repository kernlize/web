import type { ApprovalOutcome, ApprovalSignal, PermissionRequirement, ServiceHandler, ServiceRuntimeContext } from '@kehto/runtime';
import { createWebrtcService } from '@kehto/services';
import type { NostrEvent } from '@napplet/core';
import { publishAccepted } from '../applesauce/relay-backend.js';
import { subscribeWithEose, type ApplesaucePool } from '../applesauce/relay-hooks.js';
import type { AppletIdentity, AppletSummary, ConsentSummary, DirectIceServer } from '../types.js';
import { createDirectSignaling, DIRECT_SIGNAL_KIND, type SignalRelay } from './direct-signaling.js';
import type { WindowIdentities } from './window-identities.js';

/** What the direct connections service needs from the shell. */
export interface DirectConnectionsOptions {
  readonly pool: ApplesaucePool;
  /** Where people in a room find each other; read when a window first opens a session. */
  readonly relays: () => readonly string[];
  readonly identities: WindowIdentities;
  /** STUN and TURN servers the host runs or trusts; none by default. */
  readonly iceServers: readonly DirectIceServer[];
  /** Makes a peer connection; the page's `RTCPeerConnection` by default. */
  readonly createPeer?: (configuration: RTCConfiguration) => RTCPeerConnection;
  /** The verified applet a window runs, or undefined. */
  readonly appletOf: (windowId: string) => Pick<AppletSummary, 'identity' | 'publisher' | 'manifest'> | undefined;
  /** Whether the person granted this window's applet direct connections, and has not blocked it. */
  readonly isGranted: (windowId: string) => boolean;
  /** Put the summary to the person; resolve true only on yes. */
  readonly ask: (summary: ConsentSummary) => Promise<boolean>;
}

/**
 * The stable address rooms are kept apart by: the publisher, the manifest
 * kind and the applet's name, the same for every version. Paja derives the
 * same string, so one applet meets the same rooms in either shell.
 *
 * @param summary - The verified applet.
 * @returns `<publisher>:<kind>:<name>`.
 * @example
 * ```ts
 * directNamespace(summary); // 'ab12…:35129:chess'
 * ```
 */
export function directNamespace(summary: Pick<AppletSummary, 'publisher' | 'manifest'>): string {
  const [, kind, ...rest] = summary.manifest.catalogId.split(':');
  if (rest[0] === summary.publisher) rest.shift();
  return `${summary.publisher}:${kind}:${rest.join(':')}`;
}

/**
 * The consent prompt for one direct session: who it reaches, what they learn
 * about the person, what the shell cannot see, and which servers introduce
 * the two sides. A direct connection hands the other side the person's
 * network address, and what passes over it is out of the shell's sight, so
 * the prompt says both plainly.
 *
 * @param requirements - What kehto's WebRTC service planned for the session.
 * @param applet - The applet asking.
 * @returns The summary the host renders.
 * @example
 * ```ts
 * describeDirectConnection(requirements, identity).title; // 'Connect directly to other people'
 * ```
 */
export function describeDirectConnection(requirements: readonly PermissionRequirement[], applet: AppletIdentity): ConsentSummary {
  const resource = (requirements.find((requirement) => requirement.category === 'resource') as PermissionRequirement).scope.value;
  const scoped = (kind: string): string[] => requirements.filter((requirement) => requirement.category === 'network' && requirement.scope.kind === kind).map((requirement) => requirement.scope.value);
  const relays = scoped('origin').map((origin) => new URL(origin).host);
  const helpers = scoped('ice');
  const draft: NostrEvent = { kind: DIRECT_SIGNAL_KIND, content: '', tags: [['t', 'direct']], created_at: 0, pubkey: '', id: '', sig: '' };
  return {
    title: 'Connect directly to other people',
    severity: 'direct',
    lines: [
      { label: 'With', after: resource.startsWith('room:') ? `Anyone who joins "${resource.slice(5)}" in this applet` : 'One person this applet chose' },
      { label: 'They learn', after: 'Your network address, which can show roughly where you are' },
      { label: 'They see', after: 'Whatever this applet sends them. The shell cannot see it.' },
      { label: 'Introduced by', after: relays.join(', ') },
      ...(helpers.length > 0 ? [{ label: 'Helped by', after: helpers.join(', ') }] : []),
      { label: 'They know you as', after: 'A new name for this window, not your account' },
    ],
    applet,
    event: draft,
  };
}

function signalRelayOver(pool: ApplesaucePool): SignalRelay {
  return {
    subscribe(relays, filters, onEvent) {
      const handle = subscribeWithEose(pool, [...relays], filters, (item) => {
        if (item !== 'EOSE') onEvent(item);
      });
      return { close: () => handle.unsubscribe() };
    },
    async publish(relays, event) {
      await publishAccepted(pool, [...relays], event);
    },
  };
}

interface DirectWindow {
  readonly service: ServiceHandler;
  readonly lifetime: AbortController;
}

/**
 * The `webrtc` service: applets open direct sessions with other people.
 *
 * Each window gets kehto's WebRTC service over {@link createDirectSignaling},
 * signing under the window's own key. kehto opens a session only through the
 * runtime's approval step, which kernl supplies here instead of kehto's
 * permission authority: the window's applet must hold the `webrtc` grant, the
 * person is asked once per session, and the session's work stops when the
 * window ends, its grant changes or the person says no (D-042). Upstream
 * gap: kehto's ACL has no capability for `webrtc`, so the grant is checked
 * here, not by the ACL.
 *
 * @param options - Pool, relays, identities, ICE servers, peer factory and the grant and consent hooks.
 * @returns The service handler to register as `webrtc`.
 * @example
 * ```ts
 * registry.webrtc = createDirectConnectionsService({ pool, relays, identities, iceServers: [], createPeer, appletOf, isGranted, ask });
 * ```
 */
export function createDirectConnectionsService(options: DirectConnectionsOptions): ServiceHandler {
  const windows = new Map<string, DirectWindow>();
  const createPeer = options.createPeer ?? ((configuration: RTCConfiguration) => new RTCPeerConnection(configuration));
  let runtime: ServiceRuntimeContext | undefined;
  const authorize = (lifetime: ApprovalSignal) => async <T>(windowId: string, _operation: string, requirements: readonly PermissionRequirement[], execute: (signal: ApprovalSignal) => T | Promise<T>, signal?: ApprovalSignal): Promise<ApprovalOutcome<T>> => {
    const applet = options.appletOf(windowId);
    if (!applet || !options.isGranted(windowId)) return { status: 'denied' };
    if (!(await options.ask(describeDirectConnection(requirements, applet.identity)))) return { status: 'denied' };
    if (lifetime.aborted || signal?.aborted || !options.isGranted(windowId)) return { status: 'cancelled' };
    return { status: 'executed', value: await execute(lifetime) };
  };
  const windowFor = (windowId: string): DirectWindow => {
    let entry = windows.get(windowId);
    if (!entry) {
      const lifetime = new AbortController();
      const applet = options.appletOf(windowId);
      const configuration: RTCConfiguration = { iceServers: options.iceServers.map((server) => ({ ...server, urls: [...server.urls] })) };
      const service = createWebrtcService(createDirectSignaling({
        signer: options.identities.signer(windowId),
        namespace: applet ? directNamespace(applet) : '',
        relays: [...options.relays()],
        relay: signalRelayOver(options.pool),
        iceEndpoints: options.iceServers.flatMap((server) => server.urls),
        createPeer: () => createPeer(configuration),
      }));
      service.onRegistered?.({ ...runtime, authorizeOperation: authorize(lifetime.signal) } as ServiceRuntimeContext);
      entry = { service, lifetime };
      windows.set(windowId, entry);
    }
    return entry;
  };
  const end = (windowId: string): void => {
    const entry = windows.get(windowId);
    windows.delete(windowId);
    entry?.lifetime.abort();
    entry?.service.onWindowDestroyed?.(windowId);
    options.identities.release(windowId);
  };
  return {
    descriptor: { name: 'webrtc', version: '1.0.0', description: 'Direct sessions between people, each window under its own key' },
    onRegistered(context) {
      runtime = context;
    },
    onUnregistered() {
      for (const windowId of windows.keys()) end(windowId);
      runtime = undefined;
    },
    handleMessage(windowId, message, send) {
      windowFor(windowId).service.handleMessage(windowId, message, send);
    },
    onWindowDestroyed: end,
    onPermissionRevoked: end,
  };
}
