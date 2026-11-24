import { BehaviorSubject, map, of, Subject, Subscription, switchMap } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import type { AccountManager, IAccount } from 'applesauce-accounts';
import type { ISigner } from 'applesauce-signers';
import type { MessagingRegistry } from '@kernlize/messaging';
import type { BridgeRegistry } from '@kernlize/bridges';
import { buildShellCapabilities, createShellBridge, type ShellAdapter, type ShellBridge } from '@kehto/shell';
import { QUARANTINE_WINDOW_MS, createGuardConfig, describeMitigations, type GuardConfig, type GuardEvent } from '@kernlize/guard';
import type { AppletIdentity, AppletStopLimit, GuardFacade, Intents, Kernel, Kernl, KernlOptions, RelayTiers, Session } from './types.js';
import { createStorageSecrets } from './secrets/secrets.js';
import { createKernlAccounts } from './applesauce/accounts.js';
import { isReadOnlyAccount } from './applesauce/auth-hooks.js';
import type { ProfileCard, Profiles } from './profiles/profiles.js';
import type { People } from './people/person.js';
import { createKernlNetwork } from './kernl-network.js';
import type { ConnectedEventCache } from './cache/connect.js';
import type { Filter, NostrEvent } from 'applesauce-core/helpers';
import { createRelayTiers } from './relays/tiers.js';
import { SHELL_RELAY_OPTIONS } from './applesauce/relay-hooks.js';
import { decodePointer } from './applets/pointer.js';
import { defaultFetchBlob, openDefaultArtifactCache } from './applets/resolve.js';
import type { MountedApplet } from './applets/mount.js';
import { createAppletTraffic } from './applets/traffic.js';
import { createGuardPipeline, type GuardPipeline } from './guard/pipeline.js';
import { createShellFirewall } from './kernl-firewall.js';
import { createEnvironmentResolver, createGrants, type KernlGrants } from './grants/grants.js';
import { createConsentHandler, createSigningConsent, lookupReplaceable } from './consent/handler.js';
import { abbreviate } from './consent/describe-change.js';
import { createDefaultMessaging } from './messaging/default-registry.js';
import { messagingSigner } from './messaging/availability.js';
import { createPrivateMessagesBackend } from './messaging/private-backend.js';
import { createLegacyMessagesBackend } from './messaging/legacy-backend.js';
import { createRatchetMessagesBackend } from './messaging/ratchet-backend.js';
import { createGroupMessagesBackend } from './messaging/group-backend.js';
import { createKernlServices, isTheme, type KernlServiceDeps } from './kernl-services.js';
import { createShellAdapter } from './kernl-adapter.js';
import { createAppletLifecycle, resolveWindow } from './kernl-lifecycle.js';
import { checkModules, setupModules, type ComposedModules, type KernelContextParts } from './modules/compose.js';
import { kernlModules } from './modules/default.js';
import type { AnyKernlModule, ModuleApis } from './modules/module.js';
import { supportsDomainBindings } from './downloads/bindings.js';

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
export function toSession(account: IAccount, card?: ProfileCard): Session {
  const metadata = account.metadata as { name?: unknown } | undefined;
  const named = typeof metadata?.name === 'string' ? metadata.name : account.name;
  const label = named ?? (card?.found ? card.name : abbreviate(account.pubkey));
  return { accountId: account.id, pubkey: account.pubkey, label, readOnly: isReadOnlyAccount(account) };
}

interface ShellState {
  readonly bridge: ShellBridge;
  readonly accounts: AccountManager;
  readonly session$: BehaviorSubject<Session | null>;
  readonly profiles: Profiles | undefined;
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
function createSignIn(accounts: AccountManager): Pick<Kernl, 'login' | 'logout'> {
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

interface MessagingParts {
  readonly eventStore: EventStore;
  readonly pool: RelayPool;
  readonly tiers: RelayTiers;
  readonly accounts: AccountManager;
}

/** kernl's account-signer backends for `private`, `legacy` and `ratchet`, unless the host supplied its own. */
function createAccountMessaging(options: KernlOptions, parts: MessagingParts): MessagingRegistry {
  const signer = (): ISigner | undefined => messagingSigner(parts.accounts.active);
  const deps = {
    store: parts.eventStore,
    pool: parts.pool,
    tiers: parts.tiers,
    signer,
    selfPubkey: () => parts.accounts.active?.pubkey,
    accountChanges: parts.accounts.active$,
  };
  const { host } = options;
  return createDefaultMessaging({
    storage: host.storage,
    signer,
    ...(host.chooseReply ? { askReply: host.chooseReply.bind(host) } : {}),
    backends: {
      private: () => createPrivateMessagesBackend(deps),
      legacy: () => createLegacyMessagesBackend(deps),
      ratchet: () => createRatchetMessagesBackend({ ...deps, storage: options.host.storage }),
      group: () => createGroupMessagesBackend({ ...deps, storage: options.host.storage }),
      ...options.messagingBackends,
    },
  });
}

/** The host's messaging registry, or kernl's default over the shell's parts. */
function messagingFor(options: KernlOptions, parts: MessagingParts): MessagingRegistry {
  return options.messaging ?? createAccountMessaging(options, parts);
}

interface ShellParts {
  readonly handles: ReadonlyMap<string, MountedApplet>;
  readonly subscriptions: Subscription;
  readonly destroyed$: Subject<void>;
  readonly dm: { dispose(): void };
  readonly modules: { dispose(): void };
  readonly media: { destroy(): void };
  readonly bridge: ShellBridge;
  readonly traffic: { close(): void };
  /** Closed only when the shell created it. */
  readonly messaging?: MessagingRegistry;
  readonly pool?: RelayPool;
}

/** Close every applet, then everything the shell opened, the parts it was handed excepted. */
function tearDown(parts: ShellParts): void {
  for (const handle of parts.handles.values()) handle.close();
  parts.modules.dispose();
  parts.subscriptions.unsubscribe();
  parts.destroyed$.next();
  parts.dm.dispose();
  parts.media.destroy();
  parts.bridge.destroy();
  parts.traffic.close();
  parts.messaging?.close();
  parts.pool?.close();
}

/** The limit behind a quarantine, read from the profile in force as the applet crossed it. */
function quarantineLimit(reason: string, config: GuardConfig): AppletStopLimit {
  const { limits, profile } = config;
  if (reason === 'flood:hidden-resource') return { cause: 'hidden-resource', count: limits.hiddenResourceAllowance, profile };
  return { cause: 'flood', count: limits.quarantineThreshold, windowMs: QUARANTINE_WINDOW_MS, profile };
}

/** The guard in front of kehto's bridge, which quarantines and releases through it. */
function pipelineFor(options: KernlOptions, parts: { readonly handles: ReadonlyMap<string, MountedApplet>; readonly guardEvents$: Subject<GuardEvent>; readonly bridge: () => ShellBridge }): GuardPipeline {
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
  readonly messaging: MessagingRegistry;
  readonly network: { readonly profiles: Profiles | undefined; readonly people: People | undefined };
  readonly handles: ReadonlyMap<string, MountedApplet>;
  /** Whether a window is the focused one, as the guard sees it. */
  readonly isFocused: (windowId: string) => boolean;
}

/** kehto's services over the kernel's parts; `theme` and `common` are left to modules (D-062). */
function servicesFor(options: KernlOptions, parts: ServiceParts): ReturnType<typeof createKernlServices> {
  const { host } = options;
  const { handles, network } = parts;
  const identityOf = (windowId: string): AppletIdentity | undefined => handles.get(windowId)?.summary.identity;
  return createKernlServices({
    pool: parts.pool,
    tiers: parts.tiers,
    eventStore: parts.eventStore,
    auth: { getSigner: () => parts.adapter().auth.getSigner(), getUserPubkey: () => parts.adapter().auth.getUserPubkey() },
    consent: parts.consent,
    host,
    ...(parts.bridges ? { bridges: parts.bridges } : {}),
    messaging: parts.messaging,
    ...(network.profiles ? { profiles: network.profiles } : {}),
    ...(network.people ? { people: network.people } : {}),
    theme: null,
    remoteTools: null,
    shortcuts: { isFocused: parts.isFocused },
    keys: null,
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
function withApis(shell: Kernel, composed: ComposedModules): Kernel {
  const reserved = Object.keys(composed.apis).find((id) => id in shell);
  if (reserved !== undefined) {
    shell.destroy();
    throw new Error(`invalid:module-reserved:${reserved}`);
  }
  // With kernl's modules the apis complete the shell into `Kernl`; with a host's own list, the overloads type it.
  return Object.assign(shell, composed.apis);
}

/**
 * Compose the shell: one `EventStore`, one `RelayPool`, one `AccountManager`,
 * the relay tiers, the guard pipeline, the grants layer, the messaging and
 * bridge registries, kehto's services (intents included) and
 * `createShellBridge`, the applet store's catalogue, plus the applet lifecycle
 * `decodePointer` → `resolve` → `plan` → `mount`.
 *
 * Anything the host passes in `options` is used as is; anything missing is
 * created with kernl's defaults. The host wires `handleWindowMessage` to the
 * window once and supplies the frames; everything else is reached through
 * {@link KernlHost}.
 *
 * @param options - Host hooks and optional pre-built parts.
 * @returns The shell.
 * @example
 * ```ts
 * const kernl = createKernl({ host });
 * window.addEventListener('message', (event) => kernl.handleWindowMessage(event));
 * const summary = await kernl.resolve(kernl.decodePointer(address));
 * const handle = kernl.mount(await kernl.plan(summary), iframe);
 * ```
 */
export function createKernl<const M extends readonly AnyKernlModule[]>(options: KernlOptions & { readonly modules: M }): Kernel & ModuleApis<M>;
export function createKernl(options: KernlOptions): Kernl;
export function createKernl(options: KernlOptions): Kernel {
  const { host } = options;
  const modules = options.modules ?? kernlModules({ ...(isTheme(options.theme) ? { theme: options.theme } : {}), ...(options.eventCache ? { eventCache: options.eventCache } : {}), ...(host.presentSettings ? { presentSettings: host.presentSettings.bind(host) } : {}), ...(options.shortcuts ? { shortcuts: options.shortcuts } : {}), ...(options.intentRetry ? { intentRetry: options.intentRetry } : {}), ...(options.bridges ? { bridges: options.bridges } : {}), ...(options.torrent ? { torrent: options.torrent } : {}), ...(options.downloads ? { downloads: options.downloads } : {}), ...(options.remoteTools ? { remoteTools: options.remoteTools } : {}), ...(options.directConnections ? { directConnections: options.directConnections } : {}) });
  checkModules(modules);
  const ownsPool = !options.pool;
  const ownsMessaging = !options.messaging;
  const eventStore = options.eventStore ?? new EventStore();
  const pool = options.pool ?? new RelayPool(SHELL_RELAY_OPTIONS);
  const accounts = options.accounts ?? createKernlAccounts(host.storage);
  const tiers = createRelayTiers(host.storage, options.relays ?? {});
  const handles = new Map<string, MountedApplet>();
  const messaging = messagingFor(options, { eventStore, pool, tiers, accounts });

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
  const cacheRequest = (filters: Filter[]): Promise<NostrEvent[]> => (modulesSetUp.composed?.apis.cache as ConnectedEventCache | undefined)?.cacheRequest(filters) ?? Promise.resolve([]);
  const { replaceableLoader } = createKernlNetwork({ eventStore, pool, tiers, accounts, cacheRequest });
  const lookupBefore = lookupReplaceable(eventStore, { loader: replaceableLoader, relays: () => [...tiers.get().outbox, ...tiers.get().discovery] });
  const consent = createSigningConsent({ host, lookupBefore, resolveApplet: identityOf, pubkey: () => accounts.active?.pubkey });
  const secrets = options.secrets ?? createStorageSecrets(host.storage);
  const composed = composeOrClose(modules, { eventStore, pool, tiers, storage: host.storage, accounts, consent, replaceableLoader, appletOf: (windowId) => handles.get(windowId)?.summary, host, isFocused, applets: () => handles, secrets, holds(windowId, domain) {
    const identity = handles.get(windowId)?.summary.identity;
    const record = identity && grants.get(identity);
    return !!record && !record.blocked && record.domains.includes(domain);
  } }, () => {
    destroyed$.next();
    traffic.close();
    if (ownsMessaging) messaging.close();
    if (ownsPool) pool.close();
  });
  modulesSetUp.composed = composed;
  const profiles = composed.apis.profiles as Profiles | undefined;
  const people = composed.apis.people as People | undefined;
  const bridges = composed.apis.bridges as BridgeRegistry | undefined;
  const services = servicesFor(options, { pool, tiers, eventStore, adapter: () => adapter, consent, bridges, messaging, network: { profiles, people }, handles, isFocused });

  Object.assign(services.registry, composed.services);
  const { extensions } = composed;
  const guarding = createShellFirewall({ host, pipeline, handles, guardEvents$ });
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
  bridge.registerConsentHandler(createConsentHandler(host, lookupBefore, identityOf));

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

  return withApis({
    accounts,
    eventStore,
    pool,
    bridge,
    guard: createGuardFacade(pipeline, guardEvents$),
    traffic$: traffic.traffic$,
    grants,
    relays: tiers,
    messaging,
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
      tearDown({ traffic, handles, subscriptions, destroyed$, dm: services.dm, modules: composed, media: services.media, bridge, ...(ownsMessaging ? { messaging } : {}), ...(ownsPool ? { pool } : {}) }),
  }, composed);
}
