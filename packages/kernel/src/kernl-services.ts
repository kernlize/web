import type { EventStore } from 'applesauce-core';
import { verifyEvent } from 'applesauce-core/helpers';
import type { AuthHooks } from '@kehto/shell';
import type { ServiceHandler, ServiceRegistry, Signer } from '@kehto/runtime';
import {
  createConfigService,
  createIdentityService,
  createBrowserMediaPlayback,
  createLinkService,
  createNotifyService,
  createOutboxService,
  createRelayPoolOutboxRouter,
  createResourceService,
  ResourceServiceError,
  createThemeService,
  createUploadService,
  type ConfigServiceOptions,
  type OutboxPublishResult,
  type OutboxRouter,
  type RelayListEntry,
  type ResourceErrorCode,
  type ResourceFetchInit,
  type ThemeService,
  type Uploader,
} from '@kehto/services';
import type { Theme } from '@napplet/nap/theme/types';
import type { EventTemplate, NostrEvent } from '@napplet/core';
import { createBridgeRegistry, createBridgeResourceResolver, type BridgeContext, type BridgeRegistry, type ResourceResolveInit } from '@kernlize/bridges';
import type { KernlHost, RelayTiers } from './types.js';
import { createKernlMedia, type KernlMedia } from './media/kernl-media.js';
import type { ApplesaucePool } from './applesauce/relay-hooks.js';
import { createAppletRelayService, createOutboxRelayPool } from './applesauce/relay-backend.js';
import { createIdentityProviders, type IdentityProviders, type RelayPermissions } from './applesauce/identity-providers.js';
import { createOutboxEventCache } from './outbox-event-cache.js';
import { createCachedOutboxService } from './outbox-reads.js';
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

/**
 * Protocols an applet may ask the shell to open.
 *
 * @example
 * ```ts
 * LINK_PROTOCOLS.includes(new URL('mailto:a@example.com').protocol); // true
 * LINK_PROTOCOLS.includes('javascript:'); // false
 * ```
 */
export const LINK_PROTOCOLS: readonly string[] = Object.freeze(['https:', 'mailto:']);

/** What the services need from the rest of the shell. */
export interface KernlServiceDeps {
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  readonly eventStore: EventStore;
  /** Opt into the separate public-tree Outbox observation cache. */
  readonly cacheOutboxReads?: boolean;
  /** `getUserPubkey` lets the identity service name a read-only account, which has no signer. */
  readonly auth: Pick<AuthHooks, 'getSigner'> & Partial<Pick<AuthHooks, 'getUserPubkey'>>;
  /** Gates the outbox service's publishes, which kehto signs without naming the window. */
  readonly consent: SigningConsent;
  readonly host: Pick<KernlHost, 'notify' | 'openLink' | 'storage' | 'outboxCacheStorage'>;
  /** The bridges module's registry; without it the `resource` domain is not offered and the shell plays only what applets play themselves. */
  readonly bridges?: BridgeRegistry;
  /** Applet settings (NAP-CONFIG); without them the `config` domain is not offered. */
  readonly config?: ConfigServiceOptions;
  /** Uploads for applets (NAP-UPLOAD); without it the `upload` domain is not offered. */
  readonly uploader?: Uploader;
  /** The theme pushed to applets; `null` leaves the `theme` domain to a module (D-061). */
  readonly theme?: Theme | null;
  /** Maps a live window to its verified identity, or null. */
  readonly resolveIdentity: (windowId: string) => { dTag: string; aggregateHash: string } | null;
  /** Identity lookups; defaults to the applesauce-backed providers. */
  readonly identity?: IdentityProviders;
  /** Whether a window is the focused one, for the media service's autoplay. */
  readonly shortcuts: { readonly isFocused: (windowId: string) => boolean };
}

/** The registered services plus the handles the shell keeps calling. */
export interface KernlServices {
  readonly registry: ServiceRegistry;
  readonly theme: ThemeService;
  /** The `media` service under the person's media settings. */
  readonly media: KernlMedia;
}

function toRelayListEntry(relays: RelayPermissions): RelayListEntry {
  const entries = Object.entries(relays);
  return {
    read: entries.filter(([, flags]) => flags.read).map(([url]) => url),
    write: entries.filter(([, flags]) => flags.write).map(([url]) => url),
  };
}

function withShellWrites(entry: RelayListEntry, tiers: KernlServiceDeps['tiers']): RelayListEntry {
  const { outbox, super: shared } = tiers.get();
  return { read: entry.read, write: [...new Set([...outbox, ...shared])] };
}

/**
 * kehto's outbox router fails a publish unless every one of the author's
 * write relays accepted it. On an open network one server refusing or being
 * down is ordinary, so kernl reports success when any relay accepted, and
 * keeps the per-relay results so the caller sees how many did (D-028).
 * Upstream gap: the router has no acceptance policy option.
 *
 * @param router - kehto's outbox router.
 * @returns The same router with partial acceptance treated as success.
 * @example
 * ```ts
 * createOutboxService({ router: acceptAnyRelay(createRelayPoolOutboxRouter(options)) });
 * ```
 */
export function acceptAnyRelay(router: OutboxRouter): OutboxRouter {
  const accept = (result: OutboxPublishResult): OutboxPublishResult => {
    if (result.ok || !result.relays || !Object.values(result.relays).some(Boolean)) return result;
    const { error: _refused, ...accepted } = result;
    return { ...accepted, ok: true };
  };
  // Under the firewall kehto plans a publish, has the plan approved and publishes through `publishWithPlan`, so that path gets the same policy.
  const planned = router as PlannedPublishRouter;
  const publishWithPlan = planned.publishWithPlan?.bind(planned);
  return {
    ...router,
    publish: async (template, options) => accept(await router.publish(template, options)),
    ...(publishWithPlan ? { publishWithPlan: async (...args: Parameters<typeof publishWithPlan>) => accept(await publishWithPlan(...args)) } : {}),
  } as OutboxRouter;
}

/** The planned publish kehto's relay-pool router adds beside `OutboxRouter`; kehto does not export its type. */
interface PlannedPublishRouter extends OutboxRouter {
  publishWithPlan?(template: EventTemplate, plan: unknown): Promise<OutboxPublishResult>;
}

/**
 * The relays the shell itself may reach for an applet, as bare origins: the
 * form kehto's firewall takes a network destination in.
 *
 * kehto's messaging and social services have each request's relays approved
 * before they run it. In kernl the applet never chooses them: a provider finds
 * the recipient's inboxes and a post goes to the tier for its kind, so the
 * plan is every relay in the shell's tiers, which is the widest set either can
 * reach. A relay whose address is not a bare `ws:` or `wss:` origin is left out.
 *
 * @param tiers - The shell's relay tiers.
 * @returns Distinct relay origins.
 * @example
 * ```ts
 * shellRelayOrigins(tiers); // ['wss://relay.example', …]
 * ```
 */
export function shellRelayOrigins(tiers: Pick<RelayTiers, 'get'>): readonly string[] {
  const { outbox, discovery, apps, super: shared } = tiers.get();
  const origins = [...outbox, ...shared, ...discovery, ...apps].flatMap((relay) => {
    const origin = /^(wss?:\/\/[^/?#@]+)\/?$/.exec(relay)?.[1];
    return origin ? [origin] : [];
  });
  return [...new Set(origins)];
}

/**
 * Have the firewall approve the server a download contacts before it is
 * contacted. kehto's resource service passes `authorizeNetwork` when the
 * firewall is on; a web address is put to it by origin, and anything else
 * (a magnet link, a file-server address) is resolved by its bridge, which
 * names its own servers. Upstream gap: the bridge registry follows a redirect
 * itself under its own address policy, so only the first origin is put to the
 * firewall.
 *
 * @param url - The address the applet asked for.
 * @param init - What kehto's resource service passed.
 * @param run - Resolves the address under the signal it is given.
 * @returns What `run` resolved.
 * @example
 * ```ts
 * createResourceService({ fetch: (url, init) => fetchThroughFirewall(url, init, (signal) => resolve(url, { signal })) });
 * ```
 */
export function fetchThroughFirewall<T>(url: string, init: Pick<ResourceFetchInit, 'signal' | 'authorizeNetwork'>, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return init.authorizeNetwork && /^https?:/i.test(url) ? init.authorizeNetwork(url, run) : run(init.signal);
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

/** NAP-RESOURCE codes for the bridges' reasons, most specific first; the rest of a family takes its prefix's code. */
const RESOURCE_CODES: readonly (readonly [prefix: string, code: ResourceErrorCode])[] = [
  ['unavailable:no-bridge', 'unsupported-scheme'],
  ['unavailable:not-found', 'not-found'],
  ['unavailable:no-servers', 'not-found'],
  ['unavailable:timeout', 'timeout'],
  ['denied:too-large', 'too-large'],
  ['invalid:', 'invalid-request'],
  ['denied:', 'blocked-by-policy'],
];

/**
 * The NAP-RESOURCE error a bridge failure becomes. The bridges reject with
 * prefixed reasons; kehto's resource service reports any error that is not a
 * `ResourceServiceError` as `network-error`, so without this an applet could
 * not tell a missing blob or an unsupported scheme from a dead network (D-055).
 *
 * @param error - What the bridge registry rejected with.
 * @returns The error to throw to the resource service, carrying the bridge's reason as its message.
 * @example
 * ```ts
 * resourceErrorFor(new Error('unavailable:not-found')).code; // 'not-found'
 * resourceErrorFor(new Error('unavailable:network Failed to fetch')).code; // 'network-error'
 * ```
 */
export function resourceErrorFor(error: unknown): ResourceServiceError {
  const reason = error instanceof Error ? error.message : String(error);
  const code = RESOURCE_CODES.find(([prefix]) => reason.startsWith(prefix))?.[1] ?? 'network-error';
  return new ResourceServiceError(code, reason);
}

/**
 * The signer the identity service reads the account from. A read-only account
 * has no signer, yet which account is signed in is exactly what it exists to
 * show, so the service gets a view that answers `getPublicKey` and nothing
 * else: an applet the user granted "your account" learns who is signed in, and
 * every write still finds no `signEvent` and is refused.
 */
function createIdentitySigner(auth: KernlServiceDeps['auth']): () => Signer | null {
  // The identity service drops a reply when the signer object changed under
  // it, so a read-only account keeps one view for as long as it is signed in.
  let view: { readonly pubkey: string; readonly signer: Signer } | undefined;
  return () => {
    const signer = auth.getSigner();
    if (signer) return signer;
    const pubkey = auth.getUserPubkey?.() ?? null;
    if (pubkey === null) return null;
    if (view?.pubkey !== pubkey) view = { pubkey, signer: { getPublicKey: () => pubkey } };
    return view.signer;
  };
}

function createOutbox(deps: KernlServiceDeps, identity: IdentityProviders) {
  const router = createRelayPoolOutboxRouter({
    relayPool: createOutboxRelayPool(deps.pool),
    fallbackRelays: [...deps.tiers.get().super],
    async loadRelayLists(pubkeys) {
      const lists = new Map<string, RelayListEntry>();
      for (const pubkey of pubkeys) {
        const entry = toRelayListEntry(await identity.getRelays(pubkey));
        // Someone who has not said where they write is read from, and publishes to, the servers this shell writes to.
        lists.set(pubkey, entry.write.length === 0 ? withShellWrites(entry, deps.tiers) : entry);
      }
      return lists;
    },
    async signEvent(template: EventTemplate): Promise<NostrEvent> {
      const signer = deps.auth.getSigner();
      if (!signer?.signEvent) throw new Error('denied:read-only');
      return signer.signEvent(template);
    },
    verifyEvent: (event) => verifyEvent(event),
  });
  const accepting = acceptAnyRelay(router) as typeof router;
  if (!deps.cacheOutboxReads) return createOutboxService({ router: accepting });
  return createCachedOutboxService({
    router: accepting,
    cache: createOutboxEventCache(deps.host.outboxCacheStorage),
  });
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
 * `relay`, `identity`, `theme`, `notify`, `link`, `resource`,
 * and `outbox` are wired; every network path goes through the one pool, every
 * resource fetch through the bridge registry's SSRF policy, links open only
 * over `https:` and `mailto:`, notifications surface through the host, outbox
 * publishes pass the consent gate before they are signed, and remote tools are
 * called under each window's own key. An applet's shortcut runs in the focused
 * window only.
 *
 * @param deps - Pool, tiers, store, auth, consent gate, host, registries and identity resolver.
 * @returns The service registry and the theme and media handles.
 * @example
 * ```ts
 * const services = createKernlServices(deps);
 * const adapter: ShellAdapter = { ..., services: services.registry };
 * ```
 */
export function createKernlServices(deps: KernlServiceDeps): KernlServices {
  const identity = deps.identity ?? createIdentityProviders(deps.eventStore, deps.pool, deps.tiers);
  const theme = createThemeService(deps.theme ? { initialTheme: deps.theme } : {});
  // Without the bridges module nothing resolves: an empty registry refuses every address with `unavailable:no-bridge`.
  const resolve = createBridgeResourceResolver(deps.bridges ?? createBridgeRegistry());
  const resource = createResourceService({
    fetch: (url, init) =>
      fetchThroughFirewall(url, init, (signal) => resolve(url, resourceInitFor(deps, { ...init, signal }))).catch((error: unknown) => {
        throw resourceErrorFor(error);
      }),
  });
  // Built when an applet first asks, so the core runs where there is no document to play in.
  const media = createKernlMedia({ storage: deps.host.storage, playback: { open: (...args) => createBrowserMediaPlayback({ resource }).open(...args) }, isFocused: deps.shortcuts.isFocused });

  const registry: ServiceRegistry = {
    relay: createAppletRelayService(deps.pool, deps.tiers),
    identity: createIdentityService({ getSigner: createIdentitySigner(deps.auth), ...identity }),
    // `null` leaves the domain to the theme module, which answers it or, left out, has it withheld (D-062).
    ...(deps.theme === null ? {} : { theme: theme.handler }),
    notify: createNotifyService({
      present: ({ windowId, message }) => deps.host.notify({ title: message.title, windowId, tone: 'info', ...(message.body ? { body: message.body } : {}) }),
    }),
    link: createLinkService({
      allowedProtocols: LINK_PROTOCOLS,
      // kehto calls this only after the firewall let this exact link through, so the host need not ask again (D-056).
      open: ({ url }) => {
        deps.host.openLink(url.href, { approved: true });
        return { status: 'opened' };
      },
    }),
    // The firewall approves a web address's server before it is contacted (D-056); a bridge's reason becomes a NAP-RESOURCE code (D-055).
    ...(deps.bridges ? { resource } : {}),
    media: media.handler,
    outbox: gateOutboxPublish(createOutbox(deps, identity), deps.consent),
    ...(deps.config ? { config: createConfigService(deps.config).handler } : {}),
    ...(deps.uploader ? { upload: createUploadService({ uploader: deps.uploader, uploadInfo: { rails: [{ rail: 'blossom', enabled: true }] } }) } : {}),
  };
  return { registry, theme, media };
}
