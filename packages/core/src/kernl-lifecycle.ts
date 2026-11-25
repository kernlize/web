import type { Subscription } from 'rxjs';
import { originRegistry, type ShellAdapter, type ShellBridge, type ShellEnvironment } from '@kehto/shell';
import type { NappletArtifactCache } from '@kehto/nip/5d';
import type { AppletHandle, AppletIdentity, AppletPointer, AppletSummary, BuiltinApplet, FrameLike, GrantRecord, Intents, Kernel, KernlHost, MountPlan, RelayTiers } from './types.js';
import type { ApplesaucePool } from './applesauce/relay-hooks.js';
import { resolveBuiltin } from './applets/builtin.js';
import { fetchManifestEvent, resolveApplet, type PublishedPointer, type ResolvedApplet } from './applets/resolve.js';
import { planMount, resolveAppletEnvironment, type PlannedExtensions } from './applets/plan.js';
import { mountApplet, type MountedApplet } from './applets/mount.js';
import type { WindowVisibility } from '@kernlize/guard';
import type { GuardPipeline, WindowResolution } from './guard/pipeline.js';
import type { AppletAdmissions } from './firewall/admission.js';
import { createEnvironmentResolver, type KernlGrants } from './grants/grants.js';

/** What the applet lifecycle needs from the composed shell. */
export interface LifecycleContext {
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  readonly adapter: ShellAdapter;
  readonly bridge: ShellBridge;
  readonly pipeline: GuardPipeline;
  /** The firewall's say over which applets start; planning asks it and mounting checks the answer still stands. */
  readonly admissions: AppletAdmissions;
  /** Tells the firewall which applet a window id's questions are about. */
  readonly remember: (summary: AppletSummary) => void;
  readonly grants: KernlGrants;
  /** The intents module's api, when it is loaded: every planned applet is recorded there, so others can hand it work. */
  readonly intents: () => Intents | undefined;
  readonly host: Pick<KernlHost, 'onRevoked'>;
  /** Live handles keyed by window id; shared with the bridge's revocation hook. */
  readonly handles: Map<string, MountedApplet>;
  readonly subscriptions: Subscription;
  /** Told when a window is hidden or shown, after the guard. */
  readonly onVisibility: (windowId: string, visibility: WindowVisibility) => void;
  readonly openCache: () => Promise<NappletArtifactCache | undefined>;
  readonly fetchBlob: (sha256: string, servers: readonly string[]) => Promise<Uint8Array>;
  /** Applets the host ships with itself. */
  readonly builtins: readonly BuiltinApplet[];
  /** Domains kernl serves beyond kehto's list, and their bindings; `domains` here is everything offered, before grants. */
  readonly extensions?: PlannedExtensions;
}

/** The offered extension domains this applet holds: the same grants rule as every other domain, blocked and sealed applets included. */
function heldExtensions(context: LifecycleContext, identity: AppletIdentity): PlannedExtensions | undefined {
  const { extensions } = context;
  if (!extensions) return undefined;
  const held = createEnvironmentResolver(context.grants)({ dTag: identity.dTag, aggregateHash: identity.hash }, { domains: extensions.domains, services: [] });
  return { domains: held.domains, bindings: extensions.bindings };
}

/** The environment the firewall is asked about: kehto's domains and the extension domains the grants leave the applet. */
function withExtensions(environment: ShellEnvironment, extensions: PlannedExtensions | undefined): ShellEnvironment {
  if (!extensions) return environment;
  return { ...environment, capabilities: { ...environment.capabilities, domains: [...environment.capabilities.domains, ...extensions.domains] } };
}

/**
 * Why a grant change stops a running window, or nothing when it does not.
 *
 * A window keeps the environment it was started with, and `shell.init` is not
 * sent again, so a window whose grant no longer covers a domain it was started
 * with would go on advertising it. Granting more never stops a window; the
 * applet sees the new domain the next time it opens. The one grant that
 * narrows is messages: it withholds every domain that could send them on, so
 * a window started with one of those stops (D-046).
 *
 * @param plan - The running window's plan; its environment is what it was started with.
 * @param record - The grant record that just changed.
 * @param baseline - Domains every applet holds, from `grants.baselineDomains()`.
 * @returns `blocked`, `grant-narrowed`, or `undefined` when the window may keep running.
 * @example
 * ```ts
 * grants.changes$.subscribe((record) => {
 *   const reason = grantNarrowingReason(plan, record, grants.baselineDomains());
 *   if (reason) handle.revoked(reason);
 * });
 * ```
 */
export function grantNarrowingReason(plan: MountPlan, record: GrantRecord, baseline: readonly string[]): 'blocked' | 'grant-narrowed' | undefined {
  const { identity } = plan.summary;
  if (record.identity.dTag !== identity.dTag || record.identity.hash !== identity.hash) return undefined;
  if (record.blocked) return 'blocked';
  const allowed = new Set([...baseline, ...record.domains].filter((domain) => !record.withheld.includes(domain)));
  return plan.environment.capabilities.domains.some((domain) => !allowed.has(domain)) ? 'grant-narrowed' : undefined;
}

/** The applet half of {@link Kernel}. */
export type AppletLifecycle = Pick<Kernel, 'resolve' | 'install' | 'plan' | 'mount' | 'applets' | 'handleWindowMessage'>;

function keyOf(identity: AppletIdentity): string {
  return `${identity.dTag}:${identity.hash}`;
}

/**
 * Resolve the window a window-level message came from, from the shell's own
 * registry and never from the message.
 *
 * @param handles - Live applet handles.
 * @param event - The window-level message.
 * @returns The window and its applet, or null for unregistered sources.
 * @example
 * ```ts
 * resolveWindow(handles, event)?.napplet; // 'chat'
 * ```
 */
export function resolveWindow(handles: ReadonlyMap<string, MountedApplet>, event: MessageEvent): WindowResolution | null {
  const windowId = event.source ? originRegistry.getWindowId(event.source as Window) : undefined;
  const handle = windowId === undefined ? undefined : handles.get(windowId);
  return windowId !== undefined && handle ? { windowId, napplet: handle.summary.identity.dTag } : null;
}

/**
 * Load a built-in applet and, the first time the user meets it, switch on the domains its host
 * vouches for. A domain this shell cannot provide is skipped, and an applet the user already has
 * a record for is left exactly as they set it.
 */
async function resolveShipped(context: LifecycleContext, id: string): Promise<ResolvedApplet> {
  const resolved = await resolveBuiltin(context.builtins, id);
  const { identity } = resolved.summary;
  if (context.grants.get(identity)) return resolved;
  context.grants.ensure(identity);
  const offered = context.grants.availableDomains();
  const wanted = context.builtins.find((applet) => applet.id === id)?.grants ?? [];
  for (const domain of wanted) if (offered.includes(domain)) context.grants.allowDomain(identity, domain);
  return resolved;
}

/**
 * The applet lifecycle: `resolve` fetches and verifies (or loads an applet the host ships), `plan` narrows the
 * environment under the user's grants, puts the start to the firewall and installs the applet, `mount` performs the NIP-5D mount order
 * and `handleWindowMessage` runs the guard in front of the bridge.
 *
 * @param context - The composed shell's parts.
 * @returns The lifecycle methods.
 * @example
 * ```ts
 * const lifecycle = createAppletLifecycle(context);
 * const summary = await lifecycle.resolve(pointer);
 * ```
 */
export function createAppletLifecycle(context: LifecycleContext): AppletLifecycle {
  const { handles, pipeline, bridge, admissions } = context;
  // Windows planned and not yet mounted, by the applet they are for. A grant made for now outlives the
  // window that ends while its replacement is only planned, as when an applet starts again.
  const planned = new Map<string, string>();
  const stillRuns = (key: string): boolean => {
    for (const windowId of planned.keys()) if (!admissions.isWaiting(windowId)) planned.delete(windowId);
    return [...handles.values()].some((handle) => keyOf(handle.summary.identity) === key) || [...planned.values()].includes(key);
  };
  // An answer was taken back: a window admitted under it stops, as when a grant it used is taken back (D-038).
  const stopStale = (): void => {
    for (const handle of handles.values()) {
      if (admissions.isCurrent(handle.windowId)) continue;
      handle.revoked('firewall');
      bridge.revokeNapplet(handle.windowId, 'host');
    }
  };
  // kehto is still ending the work the answer covered when it tells us, so the windows stop right after it.
  const stopFollowing = admissions.onInvalidated(() => queueMicrotask(stopStale));
  context.subscriptions.add(() => {
    stopFollowing();
    admissions.close();
  });
  const verified = new Map<string, string>();
  let windowCounter = 0;
  const lookUp = async (pointer: PublishedPointer): Promise<ResolvedApplet> => {
    const event = await fetchManifestEvent(context.pool, context.tiers, pointer);
    const cache = await context.openCache();
    const { fetchBlob } = context;
    const relays = pointer.relays;
    return resolveApplet(cache ? { event, fetchBlob, cache, relays } : { event, fetchBlob, relays });
  };

  return {
    async resolve(pointer: AppletPointer): Promise<AppletSummary> {
      const resolved = pointer.kind === 'builtin' ? await resolveShipped(context, pointer.id) : await lookUp(pointer);
      verified.set(keyOf(resolved.summary.identity), resolved.indexHtml);
      return resolved.summary;
    },
    install(summary: AppletSummary) {
      if (!verified.has(keyOf(summary.identity))) throw new Error('invalid:unresolved');
      const intents = context.intents();
      if (!intents) throw new Error('unavailable:intents');
      context.grants.ensure(summary.identity);
      return intents.record(summary);
    },
    async plan(summary: AppletSummary): Promise<MountPlan> {
      const indexHtml = verified.get(keyOf(summary.identity));
      if (indexHtml === undefined) throw new Error('invalid:unresolved');
      if (context.grants.get(summary.identity)?.blocked) throw new Error('denied:blocked');
      context.grants.ensure(summary.identity);
      context.intents()?.record(summary);
      windowCounter += 1;
      const windowId = `applet-${windowCounter}`;
      planned.set(windowId, keyOf(summary.identity));
      context.remember(summary);
      const extensions = heldExtensions(context, summary.identity);
      // The firewall admits the applet before a plan exists, so no code runs with a domain it refused (D-056).
      const domains = await admissions.admit(windowId, summary, withExtensions(resolveAppletEnvironment(context.adapter, summary), extensions));
      const admitted = extensions && { ...extensions, domains: extensions.domains.filter((domain) => domains.includes(domain)) };
      return planMount({ summary, indexHtml, adapter: context.adapter, guardProfile: pipeline.config.profile, windowId, domains, ...(admitted ? { extensions: admitted } : {}) });
    },
    mount(plan: MountPlan, frame: FrameLike): AppletHandle {
      if (!admissions.isCurrent(plan.windowId)) throw new Error('denied:admission-expired');
      admissions.mounted(plan.windowId);
      planned.delete(plan.windowId);
      const handle = mountApplet(plan, frame, {
        bridge,
        originRegistry,
        guard: {
          setVisibility(windowId, visibility) {
            pipeline.setVisibility(windowId, visibility);
            context.onVisibility(windowId, visibility);
          },
          forget: (windowId) => pipeline.forget(windowId),
        },
        onRevoked: (windowId, reason, details) => context.host.onRevoked(windowId, reason, details),
      });
      handles.set(plan.windowId, handle);
      const narrowed = context.grants.changes$.subscribe((record) => {
        const reason = grantNarrowingReason(plan, record, context.grants.baselineDomains());
        if (!reason) return;
        handle.revoked(reason);
        // As for a quarantine: removing the frame does not end kehto's session, so the binding is revoked too.
        bridge.revokeNapplet(plan.windowId, 'host');
      });
      context.subscriptions.add(narrowed);
      context.subscriptions.add(handle.status$.subscribe((status) => {
        if (status !== 'closed' && status !== 'revoked') return;
        handles.delete(plan.windowId);
        narrowed.unsubscribe();
        // A window closed before it said hello has only the session admission opened for it.
        admissions.discard(plan.windowId);
        // What was granted for now goes with the applet's last window (D-060).
        if (!stillRuns(keyOf(plan.summary.identity))) context.grants.forgetTemporary(plan.summary.identity);
      }));
      return handle;
    },
    applets: () => [...handles.values()],
    handleWindowMessage(event) {
      pipeline.handleWindowMessage(event, (message) => resolveWindow(handles, message), (message) => bridge.handleMessage(message));
    },
  };
}
