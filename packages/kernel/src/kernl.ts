import { BehaviorSubject, map, of, Subject, Subscription, switchMap, type Observable } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import type { AccountManager, IAccount } from 'applesauce-accounts';
import type { BridgeRegistry } from '@kernlize/bridges';
import { buildShellCapabilities, createShellBridge, type ShellAdapter, type ShellBridge } from '@kehto/shell';
import { QUARANTINE_WINDOW_MS, createGuardConfig, describeMitigations, type GuardConfig, type GuardEvent } from '@kernlize/guard';
import type { AppletIdentity, AppletStopLimit, GuardFacade, Intents, Kernel, KernelOptions, RelayTiers, Session } from './types.js';
import { createStorageSecrets } from './secrets/secrets.js';
import { createKernlAccounts } from './applesauce/accounts.js';
import { isReadOnlyAccount } from './applesauce/auth-hooks.js';
import { createKernlNetwork } from './kernl-network.js';
import type { CacheLookup } from './cache-lookup.js';
import type { Filter, NostrEvent } from 'applesauce-core/helpers';
import { createRelayTiers } from './relays/tiers.js';
import { SHELL_RELAY_OPTIONS } from './applesauce/relay-hooks.js';
import { decodePointer } from './applets/pointer.js';
import { defaultFetchBlob, openDefaultArtifactCache } from './applets/resolve.js';
import type { MountedApplet } from './applets/mount.js';
import { createAppletTraffic } from './applets/traffic.js';
import { createGuardPipeline, type GuardPipeline } from './guard/pipeline.js';
import { createShellFirewall } from './kernl-firewall.js';
import { createAskChannel } from './asks/channel.js';
import { createEnvironmentResolver, createGrants, type KernlGrants } from './grants/grants.js';
import { createConsentHandler, createSigningConsent, lookupReplaceable } from './consent/handler.js';
import { abbreviate } from './consent/describe-change.js';
import { createKernlServices, type KernlServiceDeps } from './kernl-services.js';
import { createShellAdapter } from './kernl-adapter.js';
import { createAppletLifecycle, resolveWindow } from './kernl-lifecycle.js';
import { checkModules, setupModules, type ComposedModules, type KernelContextParts } from './module-host/compose.js';
import type { AnyKernlModule, ModuleApis } from './module-host/module.js';
import { supportsDomainBindings } from './applets/domain-bindings.js';

/** What the kernel reads of a profile to label the session: whether one was found, and its name. */
export interface SessionCard {
  readonly found: boolean;
  readonly name: string;
}

/** The profiles module's lookup, as far as the session label needs it. */
interface SessionNames {
  card$(pubkey: string): Observable<SessionCard>;
}

/**
 * Describe an account as a session the UI can show.
 *
 * @param account - An applesauce account.
 * @returns The session; `readOnly` when the account cannot sign.
 * @example
 * ```ts
 * toSession(ReadonlyAccount.fromPubkey(pubkey)).readOnly; // true
 * ```
 */
export function toSession(account: IAccount, card?: SessionCard): Session {
  const metadata = account.metadata as { name?: unknown } | undefined;
  const named = typeof metadata?.name === 'string' ? metadata.name : account.name;
  const label = named ?? (card?.found ? card.name : abbreviate(account.pubkey));
  return { accountId: account.id, pubkey: account.pubkey, label, readOnly: isReadOnlyAccount(account) };
}

interface ShellState {
  readonly bridge: ShellBridge;
  readonly accounts: AccountManager;
  readonly session$: BehaviorSubject<Session | null>;
  readonly profiles: SessionNames | undefined;
}

/** Keep the session on the active account, labelled by its profile when the profiles module is loaded. */
function followShellState({ bridge, accounts, session$, profiles }: ShellState): Subscription {
  const subscriptions = new Subscription();
  subscriptions.add(accounts.active$.subscribe((account) => bridge.publishIdentityChanged(account?.pubkey ?? '')));
  // The session's label follows the account's published name once it arrives, when the profiles module is loaded.
  const sessions = accounts.active$.pipe(switchMap((account) => {
    if (!account) return of(null);
    return profiles ? profiles.card$(account.pubkey).pipe(map((card) => toSession(account, card))) : of(toSession(account));
  }));
  subscriptions.add(sessions.subscribe(session$));
  return subscriptions;
}

/** Signing in and out. The session itself is a getter on the shell, so spreading this never copies a stale value. */
function createSignIn(accounts: AccountManager): Pick<Kernel, 'login' | 'logout'> {
  return {
    async login(account) {
      if (!accounts.getAccount(account.id)) accounts.addAccount(account);
      accounts.setActive(account);
      return toSession(account);
    },
    async logout() {
      accounts.clearActive();
    },
  };
}

function createGuardFacade(pipeline: GuardPipeline, events$: Subject<GuardEvent>): GuardFacade {
  return {
    get config() {
      return pipeline.config;
    },
    profile$: pipeline.profile$,
    setProfile: (profile) => pipeline.setProfile(profile),
    events$: events$.asObservable(),
    mitigations: () => describeMitigations(pipeline.config),
    release: (windowId) => pipeline.release(windowId),
  };
}

interface ShellParts {
  readonly handles: ReadonlyMap<string, MountedApplet>;
  readonly subscriptions: Subscription;
  readonly destroyed$: Subject<void>;
  readonly modules: { dispose(): void };
  readonly media: { destroy(): void };
  readonly bridge: ShellBridge;
  readonly traffic: { close(): void };
  /** Closed only when the shell created it. */
  readonly pool?: RelayPool;
}

/** Close every applet, then everything the shell opened, the parts it was handed excepted. */
function tearDown(parts: ShellParts): void {
  for (const handle of parts.handles.values()) handle.close();
  parts.modules.dispose();
  parts.subscriptions.unsubscribe();
  parts.destroyed$.next();
  parts.media.destroy();
  parts.bridge.destroy();
  parts.traffic.close();
  parts.pool?.close();
}

/** The limit behind a quarantine, read from the profile in force as the applet crossed it. */
function quarantineLimit(reason: string, config: GuardConfig): AppletStopLimit {
  const { limits, profile } = config;
  if (reason === 'flood:hidden-resource') return { cause: 'hidden-resource', count: limits.hiddenResourceAllowance, profile };
  return { cause: 'flood', count: limits.quarantineThreshold, windowMs: QUARANTINE_WINDOW_MS, profile };
}

/** The guard in front of kehto's bridge, which quarantines and releases through it. */
function pipelineFor(options: KernelOptions, parts: { readonly handles: ReadonlyMap<string, MountedApplet>; readonly guardEvents$: Subject<GuardEvent>; readonly bridge: () => ShellBridge }): GuardPipeline {
  const { host } = options;
  const pipeline: GuardPipeline = createGuardPipeline({
    config: createGuardConfig(options.guard?.profile ?? 'strict'),
    ...(host.now ? { now: host.now.bind(host) } : {}),
    onEvent: (event) => parts.guardEvents$.next(event),
    onQuarantine: (windowId, _napplet, reason) => {
      parts.handles.get(windowId)?.revoked('quarantine', { limit: quarantineLimit(reason, pipeline.config) });
      parts.bridge().revokeNapplet(windowId, 'host');
    },
    getVisibility: (windowId) => host.getVisibility(windowId),
    onRelease: (windowId) => parts.bridge().releaseDeferred(windowId),
  });
  return pipeline;
}

interface ServiceParts {
  readonly pool: RelayPool;
  readonly tiers: RelayTiers;
  readonly eventStore: EventStore;
  readonly adapter: () => ShellAdapter;
  readonly consent: KernlServiceDeps['consent'];
  readonly bridges: BridgeRegistry | undefined;
  readonly cacheOutboxReads: boolean;
  readonly handles: ReadonlyMap<string, MountedApplet>;
  /** Whether a window is the focused one, as the guard sees it. */
  readonly isFocused: (windowId: string) => boolean;
}

/** kehto's services over the kernel's parts; `theme` and `common` are left to modules (D-062). */
function servicesFor(options: KernelOptions, parts: ServiceParts): ReturnType<typeof createKernlServices> {
  const { host } = options;
  const { handles } = parts;
  const identityOf = (windowId: string): AppletIdentity | undefined => handles.get(windowId)?.summary.identity;
  return createKernlServices({
    pool: parts.pool,
    tiers: parts.tiers,
    eventStore: parts.eventStore,
    cacheOutboxReads: parts.cacheOutboxReads,
    auth: { getSigner: () => parts.adapter().auth.getSigner(), getUserPubkey: () => parts.adapter().auth.getUserPubkey() },
    consent: parts.consent,
    host,
    ...(parts.bridges ? { bridges: parts.bridges } : {}),
    theme: null,
    shortcuts: { isFocused: parts.isFocused },
    resolveIdentity(windowId) {
      const identity = identityOf(windowId);
      return identity ? { dTag: identity.dTag, aggregateHash: identity.hash } : null;
    },
  });
}

/** Set the modules up, or close what the shell had already opened and rethrow why they were refused. */
function composeOrClose(modules: readonly AnyKernlModule[], parts: KernelContextParts, close: () => void): ComposedModules {
  try {
    return setupModules(modules, parts, supportsDomainBindings());
  } catch (error) {
    close();
    throw error;
  }
}

/** The shell with each module's api as `kernl[id]`; an id the shell already uses is refused. */
function withApis<Apis>(shell: Kernel, composed: ComposedModules): Kernel & Apis {
  const reserved = Object.keys(composed.apis).find((id) => id in shell);
  if (reserved !== undefined) {
    shell.destroy();
    throw new Error(`invalid:module-reserved:${reserved}`);
  }
  // The apis are typed by the module list the host named: with kernl's own they complete the shell into `Kernl`.
  return Object.assign(shell, composed.apis) as Kernel & Apis;
}

/**
 * Compose the shell from the kernel and the modules the host lists, and nothing else: one
 * `EventStore`, one `RelayPool`, one `AccountManager`, the relay tiers, the guard pipeline, the
 * grants layer, kehto's services and `createShellBridge`, plus the applet lifecycle
 * `decodePointer` → `resolve` → `plan` → `mount`. Applets are offered only what the kernel and
 * those modules answer. `@kernlize/kernel` holds no module, so a host that lists its own loads
 * only what it lists (D-068).
 *
 * Anything the host passes in `options` is used as is; anything missing is created with kernl's
 * defaults. The host wires `handleWindowMessage` to the window once and supplies the frames;
 * everything else is reached through {@link KernlHost}.
 *
 * @param options - Host hooks, optional pre-built parts and the modules.
 * @returns The shell with each module's api beside it.
 * @example
 * ```ts
 * import { createKernel, type KernlModule } from '@kernlize/kernel';
 * const clock: KernlModule<'clock', { now(): number }> = { id: 'clock', setup: () => ({ api: { now: () => Date.now() } }) };
 * const kernl = createKernel({ host, modules: [clock] });
 * kernl.clock.now(); // milliseconds since the epoch
 * ```
 */
export function createKernel<const M extends readonly AnyKernlModule[]>(options: KernelOptions<M>): Kernel & ModuleApis<M> {
  const { host, modules } = options;
  checkModules(modules);
  const ownsPool = !options.pool;
  const eventStore = options.eventStore ?? new EventStore();
  const pool = options.pool ?? new RelayPool(SHELL_RELAY_OPTIONS);
  const accounts = options.accounts ?? createKernlAccounts(host.storage);
  const tiers = createRelayTiers(host.storage, options.relays ?? {});
  const handles = new Map<string, MountedApplet>();

  const guardEvents$ = new Subject<GuardEvent>();
  const session$ = new BehaviorSubject<Session | null>(null);
  const destroyed$ = new Subject<void>();
  const subscriptions = new Subscription();
  let grants: KernlGrants;

  const pipeline = pipelineFor(options, { handles, guardEvents$, bridge: () => bridge });
  // One focus, the guard's, for the keys module's shortcuts and the media service's autoplay.
  const isFocused = (windowId: string): boolean => pipeline.getVisibility(windowId).focused;
  const traffic = createAppletTraffic((windowId) => handles.has(windowId));

  const identityOf = (windowId: string): AppletIdentity | undefined => handles.get(windowId)?.summary.identity;
  const modulesSetUp: { composed?: ComposedModules } = {};
  // The cache module's lookup, asked before any relay; nothing is cached until it is set up or when it is left out.
  const cacheRequest = (filters: Filter[]): Promise<NostrEvent[]> => (modulesSetUp.composed?.apis.cache as CacheLookup | undefined)?.cacheRequest(filters) ?? Promise.resolve([]);
  const { replaceableLoader } = createKernlNetwork({ eventStore, pool, tiers, accounts, cacheRequest });
  const lookupBefore = lookupReplaceable(eventStore, { loader: replaceableLoader, relays: () => [...tiers.get().outbox, ...tiers.get().discovery] });
  // An answer is the asking window's only: it is discarded once that window closed or runs another applet (D-067).
  const asks = createAskChannel({ host, isAsking: (windowId, ask) => handles.get(windowId)?.summary.identity.hash === ask.applet?.hash });
  const consent = createSigningConsent({ host: asks, lookupBefore, resolveApplet: identityOf, pubkey: () => accounts.active?.pubkey });
  const secrets = options.secrets ?? createStorageSecrets(host.storage);
  const composed = composeOrClose(modules, { eventStore, pool, tiers, storage: host.storage, accounts, consent, replaceableLoader, appletOf: (windowId) => handles.get(windowId)?.summary, host, asks, isFocused, focusChanges$: pipeline.focusChanges$, applets: () => handles, secrets, holds(windowId, domain) {
    const identity = handles.get(windowId)?.summary.identity;
    const record = identity && grants.get(identity);
    return !!record && !record.blocked && record.domains.includes(domain);
  } }, () => {
    destroyed$.next();
    traffic.close();
    if (ownsPool) pool.close();
  });
  modulesSetUp.composed = composed;
  const profiles = composed.apis.profiles as SessionNames | undefined;
  const bridges = composed.apis.bridges as BridgeRegistry | undefined;
  const cacheOutboxReads = (composed.apis.cache as CacheLookup | undefined)?.cacheOutboxReads === true;
  const services = servicesFor(options, { pool, tiers, eventStore, adapter: () => adapter, consent, bridges, handles, isFocused, cacheOutboxReads });

  Object.assign(services.registry, composed.services);
  const { extensions } = composed;
  const guarding = createShellFirewall({ host, asks, pipeline, handles, guardEvents$ });
  const adapter: ShellAdapter = createShellAdapter({
    pool,
    tiers,
    accounts,
    consent,
    services: services.registry,
    resolveEnvironment: (identity, available) => createEnvironmentResolver(grants)(identity, available),
    disabledDomains: composed.unanswered,
    onNappletRevoked: ({ windowId, reason, detail }) => handles.get(windowId)?.revoked(reason, { detail }),
    onNappletMessage: (windowId, message) => traffic.fromApplet(windowId, 'port', message),
    filterNappletMessage: (windowId, message) => pipeline.observe(windowId, identityOf(windowId)?.dTag ?? 'unknown', message),
    getFocusContext: (windowId) => ({ focused: pipeline.getVisibility(windowId).focused }),
    permissions: guarding.permissions,
    ...(host.onShortcut ? { onShortcut: host.onShortcut.bind(host) } : {}),
  });
  const bridge = createShellBridge(adapter);
  grants = createGrants({ acl: bridge.runtime.aclState, storage: host.storage, availableDomains: () => [...buildShellCapabilities(adapter).domains, ...(extensions?.domains ?? [])], unanswered: () => composed.unanswered });
  bridge.registerConsentHandler(createConsentHandler(asks, lookupBefore, identityOf));

  const { firewall, admissions } = guarding.attach(bridge.runtime);
  subscriptions.add(() => firewall.close());
  subscriptions.add(followShellState({ bridge, accounts, session$, profiles }));

  const lifecycle = createAppletLifecycle({
    pool,
    tiers,
    adapter,
    bridge,
    pipeline,
    admissions,
    remember: guarding.remember,
    grants,
    intents: () => composed.apis.intents as Intents | undefined,
    host,
    handles,
    subscriptions,
    onVisibility: (windowId, visibility) => services.media.setWindowVisible(windowId, visibility.visible),
    openCache: options.artifactCache ?? openDefaultArtifactCache,
    fetchBlob: host.fetchBlob ? host.fetchBlob.bind(host) : defaultFetchBlob,
    builtins: options.builtins ?? [], ...(extensions ? { extensions } : {}),
  });

  return withApis<ModuleApis<M>>({
    accounts,
    eventStore,
    pool,
    bridge,
    guard: createGuardFacade(pipeline, guardEvents$),
    traffic$: traffic.traffic$,
    grants,
    relays: tiers,
    secrets: secrets.description,
    firewall,
    media: services.media,
    session$,
    get session() {
      return session$.value;
    },
    ...createSignIn(accounts),
    decodePointer,
    ...lifecycle,
    handleWindowMessage(event) {
      // Reported before kehto sees it: a message that gets the applet stopped is the one worth seeing.
      const from = resolveWindow(handles, event);
      if (from) traffic.fromApplet(from.windowId, 'window', event.data);
      lifecycle.handleWindowMessage(event);
    },
    destroy: () =>
      tearDown({ traffic, handles, subscriptions, destroyed$, modules: composed, media: services.media, bridge, ...(ownsPool ? { pool } : {}) }),
  }, composed);
}
