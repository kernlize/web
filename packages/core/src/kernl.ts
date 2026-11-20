import { BehaviorSubject, map, of, Subject, Subscription, switchMap } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import type { AccountManager, IAccount } from 'applesauce-accounts';
import type { ISigner } from 'applesauce-signers';
import type { MessagingRegistry } from '@kernlize/messaging';
import type { BridgeContext } from '@kernlize/bridges';
import { buildShellCapabilities, createShellBridge, type ShellAdapter, type ShellBridge } from '@kehto/shell';
import { createGuardConfig, describeMitigations, type GuardEvent } from '@kernlize/guard';
import type { AccountFileServers } from './files/file-servers.js';
import type { AppletIdentity, AppletSummary, Grants, GuardFacade, Kernl, KernlHost, KernlMultiplayer, KernlOptions, RelayTiers, Session } from './types.js';
import { createKernlDownloads, type KernlDownloads } from './kernl-downloads.js';
import { createMultiplayerSettings } from './multiplayer/settings.js';
import { createStorageSecrets, type SecretsProvider } from './secrets/secrets.js';
import { discoverToolFamilies } from './multiplayer/tool-discovery.js';
import { createKernlAccounts } from './applesauce/accounts.js';
import { isReadOnlyAccount } from './applesauce/auth-hooks.js';
import type { ProfileCard, Profiles } from './profiles/profiles.js';
import { commonActionsFor, createKernlNetwork } from './kernl-network.js';
import { createAppletConfig } from './applets/applet-config.js';
import { askUploadConsent, createBlossomUploader, type BlossomUploaderOptions } from './files/uploader.js';
import type { Uploader } from '@kehto/services';
import type { AccountMailboxes } from './relays/mailboxes.js';
import { createRelayTiers } from './relays/tiers.js';
import { SHELL_RELAY_OPTIONS } from './applesauce/relay-hooks.js';
import { decodePointer } from './applets/pointer.js';
import { defaultFetchBlob, openDefaultArtifactCache } from './applets/resolve.js';
import type { MountedApplet } from './applets/mount.js';
import { createGuardPipeline, type GuardPipeline } from './guard/pipeline.js';
import { applyRuntimeFirewallProfile, applyRuntimeFirewallRules, createRuntimeFirewallHooks, type RuntimeFirewallState } from './guard/runtime-rules.js';
import { createEnvironmentResolver, createGrants, type KernlGrants } from './grants/grants.js';
import { createConsentHandler, createSigningConsent, lookupReplaceable } from './consent/handler.js';
import { abbreviate } from './consent/describe-change.js';
import { createDefaultMessaging } from './messaging/default-registry.js';
import { messagingSigner } from './messaging/availability.js';
import { createPrivateMessagesBackend } from './messaging/private-backend.js';
import { createLegacyMessagesBackend } from './messaging/legacy-backend.js';
import { createRatchetMessagesBackend } from './messaging/ratchet-backend.js';
import { createGroupMessagesBackend } from './messaging/group-backend.js';
import { createDefaultBridges } from './bridges/default-registry.js';
import { createKernlServices, isTheme, type DirectConnectionsDeps, type KernlServiceDeps } from './kernl-services.js';
import { createWindowIdentities } from './multiplayer/window-identities.js';
import type { ApplesaucePool } from './applesauce/relay-hooks.js';
import { createShellAdapter } from './kernl-adapter.js';
import { createAppletLifecycle } from './kernl-lifecycle.js';
import { createKernlIntents } from './kernl-intents.js';
import { loadCatalog, streamCatalog } from './catalog/fetch.js';

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
  readonly pipeline: GuardPipeline;
  readonly firewall: RuntimeFirewallState;
  readonly bridge: ShellBridge;
  readonly handles: ReadonlyMap<string, MountedApplet>;
  readonly accounts: AccountManager;
  readonly session$: BehaviorSubject<Session | null>;
  readonly profiles: Profiles;
  readonly mailboxes: AccountMailboxes;
  readonly tiers: RelayTiers;
}

/** Keep the runtime firewall on the guard's profile and the session on the active account. */
function followShellState({ pipeline, firewall, bridge, handles, accounts, session$, profiles, mailboxes, tiers }: ShellState): Subscription {
  const subscriptions = new Subscription();
  subscriptions.add(pipeline.profile$.subscribe(() => {
    applyRuntimeFirewallProfile(firewall, pipeline.config);
    for (const handle of handles.values()) applyRuntimeFirewallRules(firewall, pipeline.config, handle.summary.identity.dTag);
  }));
  subscriptions.add(accounts.active$.subscribe((account) => bridge.publishIdentityChanged(account?.pubkey ?? '')));
  // The session's label follows the account's published name once it arrives.
  const sessions = accounts.active$.pipe(switchMap((account) => (account ? profiles.card$(account.pubkey).pipe(map((card) => toSession(account, card))) : of(null))));
  subscriptions.add(sessions.subscribe(session$));
  // Where the account says it publishes is where the shell publishes for it (NIP-65, D-029).
  subscriptions.add(mailboxes.state$.subscribe((state) => {
    if (state.status === 'found') tiers.set('outbox', state.mailboxes.outboxes);
  }));
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

/**
 * The servers a running applet's manifest names, for the applet the bridges say asked. An applet's
 * own assets sit beside its artifact, and a `blossom:` reference usually names no server (D-055).
 */
function manifestServersOf(handles: ReadonlyMap<string, MountedApplet>, requester: BridgeContext['requester']): readonly string[] {
  if (requester === 'shell') return [];
  for (const handle of handles.values()) {
    const { identity, manifest } = handle.summary;
    if (identity.dTag === requester.dTag && identity.hash === requester.hash) return manifest.servers;
  }
  return [];
}

/** The host's messaging and bridge registries, or kernl's defaults over the shell's parts. */
function registriesFor(options: KernlOptions, parts: MessagingParts, handles: ReadonlyMap<string, MountedApplet>): Pick<Kernl, 'messaging' | 'bridges'> {
  const { host } = options;
  return {
    messaging: options.messaging ?? createAccountMessaging(options, parts),
    // host.openLink asks before leaving kernl, so every hand-off is confirmed by the user (D-010).
    bridges: options.bridges ?? createDefaultBridges({
      handoff: (uri) => host.openLink(uri),
      blossomServers: (requester) => manifestServersOf(handles, requester),
      ...(options.torrent ? { torrent: options.torrent } : {}),
    }),
  };
}

interface MeetingParts {
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  readonly appletOf: (windowId: string) => AppletSummary | undefined;
  readonly grants: () => Grants;
}

/**
 * Remote tools and direct connections: the window keys they share, the host's settings, and the
 * person's own, with a search for tool families over the servers they chose, else the host's, else
 * the general ones (D-041, D-042, D-043).
 */
function meetingFor(options: KernlOptions, parts: MeetingParts): { deps: Pick<KernlServiceDeps, 'identities' | 'remoteTools' | 'directConnections' | 'multiplayer'>; multiplayer: KernlMultiplayer } {
  const settings = createMultiplayerSettings(options.host.storage);
  const relays = (): readonly string[] => settings.state().servers ?? options.remoteTools?.relays ?? parts.tiers.get().super;
  const multiplayer = { ...settings, discover: (input: string) => discoverToolFamilies(input, { pool: parts.pool, relays: relays(), fetch: globalThis.fetch.bind(globalThis) }) };
  return {
    deps: { identities: createWindowIdentities(), remoteTools: options.remoteTools, directConnections: directConnectionsFor(options, parts.appletOf, parts.grants), multiplayer },
    multiplayer,
  };
}

/** Uploads to the account's file servers, asking the person about each file in the name of the applet that sent it (D-033). */
function uploaderFor(host: KernlHost, files: AccountFileServers, signer: BlossomUploaderOptions['signer'], identityOf: (windowId: string) => AppletIdentity | undefined): Uploader {
  return createBlossomUploader({
    servers: () => files.current(),
    signer,
    ask: (windowId, details) => askUploadConsent(host, identityOf(windowId), details),
  });
}

/**
 * Direct connections, when this page can make peer connections. A session is
 * open to an applet the person granted `webrtc` and did not block, and each one
 * is put to the person through the host's consent prompt (D-042).
 */
function directConnectionsFor(options: KernlOptions, appletOf: (windowId: string) => AppletSummary | undefined, grants: () => Grants): DirectConnectionsDeps | undefined {
  const { createPeer, ...settings } = options.directConnections ?? {};
  if (!createPeer && typeof RTCPeerConnection !== 'function') return undefined;
  return {
    settings,
    ...(createPeer ? { createPeer } : {}),
    appletOf,
    isGranted(windowId) {
      const identity = appletOf(windowId)?.identity;
      const record = identity && grants().get(identity);
      return !!record && !record.blocked && record.domains.includes('webrtc');
    },
    ask: (summary) => new Promise((resolve) => options.host.presentConsent({ summary, resolve })),
  };
}

/**
 * The download programs and their services. An NZB an applet names by address is fetched through
 * the web bridge, so it meets the same address policy and size limit as any other fetch (D-050).
 */
function downloadsFor(options: KernlOptions, bridges: Kernl['bridges'], identityOf: (windowId: string) => AppletIdentity | undefined, ownerOf: (windowId: string) => string | undefined): KernlDownloads & { readonly secrets: SecretsProvider } {
  const secrets = options.secrets ?? createStorageSecrets(options.host.storage);
  return { secrets, ...createKernlDownloads({
    host: options.host,
    options: options.downloads,
    secrets,
    identityOf,
    ownerOf,
    async fetchDocument(url, signal) {
      const result = await bridges.resolve(url, { requester: 'shell', signal });
      if (result.kind !== 'bytes') throw new Error('unavailable:not-a-document');
      return new Uint8Array(await result.response.arrayBuffer());
    },
  }) };
}

/** The applet a window runs, keyed by its catalogue id so its settings outlive a version. */
function appletOf(handles: ReadonlyMap<string, MountedApplet>, windowId: string): { key: string; title: string } | undefined {
  const summary = handles.get(windowId)?.summary;
  return summary && { key: summary.manifest.catalogId, title: summary.title };
}

interface ShellParts {
  readonly handles: ReadonlyMap<string, MountedApplet>;
  readonly subscriptions: Subscription;
  readonly destroyed$: Subject<void>;
  readonly network: { readonly directory: { stop(): void }; readonly eventCache: { close(): Promise<void> } };
  readonly intents: { close(): void };
  readonly dm: { dispose(): void };
  readonly downloads: { dispose(): void };
  readonly keys: { destroy(): void };
  readonly bridge: ShellBridge;
  /** Closed only when the shell created it. */
  readonly messaging?: MessagingRegistry;
  readonly pool?: RelayPool;
}

/** Close every applet, then everything the shell opened, the parts it was handed excepted. */
function tearDown(parts: ShellParts): void {
  for (const handle of parts.handles.values()) handle.close();
  parts.subscriptions.unsubscribe();
  parts.destroyed$.next();
  parts.network.directory.stop();
  void parts.network.eventCache.close();
  parts.intents.close();
  parts.dm.dispose();
  parts.downloads.dispose();
  parts.keys.destroy();
  parts.bridge.destroy();
  parts.messaging?.close();
  parts.pool?.close();
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
export function createKernl(options: KernlOptions): Kernl {
  const { host } = options;
  const ownsPool = !options.pool;
  const ownsMessaging = !options.messaging;
  const eventStore = options.eventStore ?? new EventStore();
  const pool = options.pool ?? new RelayPool(SHELL_RELAY_OPTIONS);
  const accounts = options.accounts ?? createKernlAccounts(host.storage);
  const tiers = createRelayTiers(host.storage, options.relays ?? {});
  const handles = new Map<string, MountedApplet>();
  const { messaging, bridges } = registriesFor(options, { eventStore, pool, tiers, accounts }, handles);

  const guardEvents$ = new Subject<GuardEvent>();
  const session$ = new BehaviorSubject<Session | null>(null);
  const destroyed$ = new Subject<void>();
  const subscriptions = new Subscription();
  let grants: KernlGrants;

  const pipeline = createGuardPipeline({
    config: createGuardConfig(options.guard?.profile ?? 'strict'),
    ...(host.now ? { now: host.now.bind(host) } : {}),
    onEvent: (event) => guardEvents$.next(event),
    onQuarantine: (windowId) => {
      handles.get(windowId)?.revoked('quarantine');
      bridge.revokeNapplet(windowId, 'host');
    },
    getVisibility: (windowId) => host.getVisibility(windowId),
    onRelease: (windowId) => bridge.releaseDeferred(windowId),
  });

  const identityOf = (windowId: string): AppletIdentity | undefined => handles.get(windowId)?.summary.identity;
  const { eventCache, replaceableLoader, profiles, people, directory, mailboxes, files, signer } = createKernlNetwork(options, { eventStore, pool, tiers, accounts, destroyed$ });
  const lookupBefore = lookupReplaceable(eventStore, { loader: replaceableLoader, relays: () => [...tiers.get().outbox, ...tiers.get().discovery] });
  const consent = createSigningConsent({ host, lookupBefore, resolveApplet: identityOf, pubkey: () => accounts.active?.pubkey });
  const meeting = meetingFor(options, { pool, tiers, appletOf: (windowId) => handles.get(windowId)?.summary, grants: () => grants });
  const downloads = downloadsFor(options, bridges, identityOf, (windowId) => handles.get(windowId)?.summary.manifest.catalogId);
  const services = createKernlServices({
    pool,
    tiers,
    eventStore,
    auth: { getSigner: () => adapter.auth.getSigner(), getUserPubkey: () => adapter.auth.getUserPubkey() },
    consent,
    host,
    bridges,
    messaging,
    profiles,
    people,
    ...(host.presentSettings ? { config: createAppletConfig({ storage: host.storage, appletOf: (windowId) => appletOf(handles, windowId), present: host.presentSettings.bind(host) }) } : {}),
    common: commonActionsFor({ eventStore, pool, tiers, accounts }, { profiles, people, replaceableLoader, signer }, consent),
    uploader: uploaderFor(host, files, signer, identityOf),
    ...(isTheme(options.theme) ? { theme: options.theme } : {}),
    ...meeting.deps,
    shortcuts: { ...options.shortcuts, isFocused: (windowId) => pipeline.getVisibility(windowId).focused },
    resolveIdentity(windowId) {
      const identity = identityOf(windowId);
      return identity ? { dTag: identity.dTag, aggregateHash: identity.hash } : null;
    },
  });

  const intents = createKernlIntents({ host, pool, tiers, accounts, handles, ...(options.intentRetry ? { retry: options.intentRetry } : {}) });
  Object.assign(services.registry, { intent: intents.handler }, downloads.services);
  const runtimeFirewall = createRuntimeFirewallHooks({
    storage: host.storage,
    onEvent: (event) => guardEvents$.next(event),
    ...(host.now ? { now: host.now.bind(host) } : {}),
  });
  const adapter: ShellAdapter = createShellAdapter({
    pool,
    tiers,
    accounts,
    consent,
    services: services.registry,
    resolveEnvironment: (identity, available) => createEnvironmentResolver(grants)(identity, available),
    onNappletRevoked: ({ windowId, reason }) => handles.get(windowId)?.revoked(reason),
    filterNappletMessage: (windowId, message) => pipeline.observe(windowId, identityOf(windowId)?.dTag ?? 'unknown', message),
    getFocusContext: (windowId) => ({ focused: pipeline.getVisibility(windowId).focused }),
    runtimeFirewall,
    ...(host.onShortcut ? { onShortcut: host.onShortcut.bind(host) } : {}),
  });
  const bridge = createShellBridge(adapter);
  grants = createGrants({ acl: bridge.runtime.aclState, storage: host.storage, availableDomains: () => [...buildShellCapabilities(adapter).domains, ...(downloads.extensions?.domains ?? [])] });
  bridge.registerConsentHandler(createConsentHandler(host, lookupBefore, identityOf));

  subscriptions.add(followShellState({ pipeline, firewall: runtimeFirewall.legacyFirewall, bridge, handles, accounts, session$, profiles, mailboxes, tiers }));

  const lifecycle = createAppletLifecycle({
    pool,
    tiers,
    adapter,
    bridge,
    pipeline,
    firewall: runtimeFirewall.legacyFirewall,
    grants,
    installed: intents.installed,
    host,
    handles,
    subscriptions,
    openCache: options.artifactCache ?? openDefaultArtifactCache,
    fetchBlob: host.fetchBlob ? host.fetchBlob.bind(host) : defaultFetchBlob,
    builtins: options.builtins ?? [], ...(downloads.extensions ? { extensions: downloads.extensions } : {}),
  });

  return {
    accounts,
    eventStore,
    pool,
    bridge,
    guard: createGuardFacade(pipeline, guardEvents$),
    grants,
    relays: tiers,
    messaging,
    bridges,
    catalog: {
      load: (loadOptions) => loadCatalog(pool, tiers, { cache: eventCache.cacheRequest, store: eventStore, ...loadOptions }),
      stream: (streamOptions) => streamCatalog(pool, tiers, { cache: eventCache.cacheRequest, store: eventStore, ...streamOptions }),
    },
    profiles,
    people,
    mailboxes,
    files,
    multiplayer: meeting.multiplayer, downloads: downloads.programs, secrets: downloads.secrets.description,
    directory,
    intents: intents.intents,
    session$,
    get session() {
      return session$.value;
    },
    ...createSignIn(accounts),
    decodePointer,
    ...lifecycle,
    destroy: () =>
      tearDown({ handles, subscriptions, destroyed$, network: { directory, eventCache }, intents, dm: services.dm, downloads, keys: services.keys, bridge, ...(ownsMessaging ? { messaging } : {}), ...(ownsPool ? { pool } : {}) }),
  };
}
