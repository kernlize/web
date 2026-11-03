import type { EventStore } from 'applesauce-core';
import { verifyEvent } from 'applesauce-core/helpers';
import type { AuthHooks } from '@kehto/shell';
import type { ServiceHandler, ServiceRegistry } from '@kehto/runtime';
import {
  createDmService,
  createIdentityService,
  createLinkService,
  createNotifyService,
  createOutboxService,
  createRelayPoolOutboxRouter,
  createRelayPoolService,
  createResourceService,
  createThemeService,
  type DmService,
  type RelayListEntry,
  type ResourceFetchInit,
  type ThemeService,
} from '@kehto/services';
import type { Theme } from '@napplet/nap/theme/types';
import type { EventTemplate, NostrEvent } from '@napplet/core';
import { createBridgeResourceResolver, type BridgeContext, type BridgeRegistry, type ResourceResolveInit } from '@kernl/bridges';
import type { MessagingRegistry } from '@kernl/messaging';
import type { KernlHost, RelayTiers } from './types.js';
import type { ApplesaucePool } from './applesauce/relay-hooks.js';
import { createAppletRelayBackend, createOutboxRelayPool } from './applesauce/relay-backend.js';
import { createIdentityProviders, type IdentityProviders, type RelayPermissions } from './applesauce/identity-providers.js';
import type { SigningConsent, SigningTemplate } from './consent/handler.js';

/**
 * Whether a host-supplied theme has the colours NAP-THEME requires.
 *
 * @param value - The `theme` option as the host passed it.
 * @returns True when `colors.background`, `colors.text` and `colors.primary` are strings.
 * @example
 * ```ts
 * isTheme({ colors: { background: '#000', text: '#fff', primary: '#7aa2f7' } }); // true
 * ```
 */
export function isTheme(value: Record<string, unknown> | undefined): value is Record<string, unknown> & Theme {
  const colors = value?.colors;
  if (typeof colors !== 'object' || colors === null) return false;
  const { background, text, primary } = colors as Record<string, unknown>;
  return typeof background === 'string' && typeof text === 'string' && typeof primary === 'string';
}

/** Protocols an applet may ask the shell to open. */
export const LINK_PROTOCOLS: readonly string[] = Object.freeze(['https:', 'mailto:']);

/** What the services need from the rest of the shell. */
export interface KernlServiceDeps {
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  readonly eventStore: EventStore;
  readonly auth: Pick<AuthHooks, 'getSigner'>;
  /** Gates the outbox service's publishes, which kehto signs without naming the window. */
  readonly consent: SigningConsent;
  readonly host: Pick<KernlHost, 'notify' | 'openLink'>;
  readonly bridges: BridgeRegistry;
  readonly messaging: MessagingRegistry;
  readonly theme?: Theme;
  /** Maps a live window to its verified identity, or null. */
  readonly resolveIdentity: (windowId: string) => { dTag: string; aggregateHash: string } | null;
  /** Identity lookups; defaults to the applesauce-backed providers. */
  readonly identity?: IdentityProviders;
}

/** The registered services plus the handles the shell keeps calling. */
export interface KernlServices {
  readonly registry: ServiceRegistry;
  readonly theme: ThemeService;
  readonly dm: DmService;
}

function toRelayListEntry(relays: RelayPermissions): RelayListEntry {
  const entries = Object.entries(relays);
  return {
    read: entries.filter(([, flags]) => flags.read).map(([url]) => url),
    write: entries.filter(([, flags]) => flags.write).map(([url]) => url),
  };
}

function requesterFor(deps: Pick<KernlServiceDeps, 'resolveIdentity'>, windowId: string | undefined): BridgeContext['requester'] {
  const identity = windowId === undefined ? null : deps.resolveIdentity(windowId);
  return identity ? { dTag: identity.dTag, hash: identity.aggregateHash } : 'shell';
}

/**
 * Translate the resource service's fetch init into the bridge resolver's,
 * naming the applet that asked so the bridge consent hook can see it.
 *
 * @param deps - Supplies the window-to-identity lookup.
 * @param init - What kehto's resource service passes to `fetch`.
 * @returns The init for `createBridgeResourceResolver`'s resolver.
 * @example
 * ```ts
 * resourceInitFor(deps, { signal, windowId: 'w1' }).requester; // { dTag: 'chat', hash: '…' }
 * ```
 */
export function resourceInitFor(deps: Pick<KernlServiceDeps, 'resolveIdentity'>, init: ResourceFetchInit): ResourceResolveInit {
  const requester = requesterFor(deps, init.windowId);
  return init.headers ? { signal: init.signal, requester, headers: init.headers } : { signal: init.signal, requester };
}

function createOutbox(deps: KernlServiceDeps, identity: IdentityProviders) {
  const router = createRelayPoolOutboxRouter({
    relayPool: createOutboxRelayPool(deps.pool),
    fallbackRelays: [...deps.tiers.get().super],
    async loadRelayLists(pubkeys) {
      const lists = new Map<string, RelayListEntry>();
      for (const pubkey of pubkeys) lists.set(pubkey, toRelayListEntry(await identity.getRelays(pubkey)));
      return lists;
    },
    async signEvent(template: EventTemplate): Promise<NostrEvent> {
      const signer = deps.auth.getSigner();
      if (!signer?.signEvent) throw new Error('denied:read-only');
      return signer.signEvent(template);
    },
    verifyEvent: (event) => verifyEvent(event),
  });
  return createOutboxService({ router });
}

/**
 * Put the outbox service's publishes through the consent gate.
 *
 * kehto's outbox router signs through a `signEvent` that is not told which
 * window asked, so the gate cannot sit at the signer as it does for `relay`.
 * It sits in front of the service instead, where the window is still known:
 * the publish reaches the router only after the gate resolves.
 *
 * @param outbox - kehto's outbox service.
 * @param consent - The signing consent gate.
 * @returns The same service with `outbox.publish` gated.
 * @example
 * ```ts
 * registry.outbox = gateOutboxPublish(createOutboxService({ router }), consent);
 * ```
 */
function gateOutboxPublish(outbox: ServiceHandler, consent: SigningConsent): ServiceHandler {
  return {
    ...outbox,
    handleMessage(windowId, message, send) {
      if (message.type !== 'outbox.publish') {
        outbox.handleMessage(windowId, message, send);
        return;
      }
      const { id, event } = message as { id?: string; event?: SigningTemplate | null };
      consent(windowId, event ?? {}).then(
        () => outbox.handleMessage(windowId, message, send),
        (error: Error) => {
          const refusal = { type: 'outbox.publish.result', id: id ?? '', ok: false, error: error.message };
          send(refusal);
        },
      );
    },
  };
}

/**
 * Register kehto's reference services over the shell's applesauce layer.
 *
 * `relay`, `identity`, `theme`, `notify`, `link`, `resource`, `dm` and `outbox`
 * are wired; every network path goes through the one pool, every resource
 * fetch through the bridge registry's SSRF policy, links open only over
 * `https:` and `mailto:`, notifications surface through the host, and outbox
 * publishes pass the consent gate before they are signed.
 *
 * @param deps - Pool, tiers, store, auth, consent gate, host, registries and identity resolver.
 * @returns The service registry and the theme and dm handles.
 * @example
 * ```ts
 * const services = createKernlServices(deps);
 * const adapter: ShellAdapter = { ..., services: services.registry };
 * ```
 */
export function createKernlServices(deps: KernlServiceDeps): KernlServices {
  const identity = deps.identity ?? createIdentityProviders(deps.eventStore, deps.pool, deps.tiers);
  const theme = createThemeService(deps.theme ? { initialTheme: deps.theme } : {});
  const dm = createDmService({ adapter: deps.messaging.composite() });
  const resolve = createBridgeResourceResolver(deps.bridges);

  const registry: ServiceRegistry = {
    relay: createRelayPoolService(createAppletRelayBackend(deps.pool, deps.tiers)),
    identity: createIdentityService({ getSigner: () => deps.auth.getSigner(), ...identity }),
    theme: theme.handler,
    notify: createNotifyService({
      present: ({ windowId, message }) => deps.host.notify({ title: message.title, windowId, tone: 'info', ...(message.body ? { body: message.body } : {}) }),
    }),
    link: createLinkService({
      allowedProtocols: LINK_PROTOCOLS,
      open: ({ url }) => {
        deps.host.openLink(url.href);
        return { status: 'opened' };
      },
    }),
    resource: createResourceService({
      fetch: (url, init) => resolve(url, resourceInitFor(deps, init)),
      resolveIdentity: deps.resolveIdentity,
    }),
    dm,
    outbox: gateOutboxPublish(createOutbox(deps, identity), deps.consent),
  };
  return { registry, theme, dm };
}
