import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import type { AccountManager, IAccount } from 'applesauce-accounts';
import type { ISigner } from 'applesauce-signers';
import type { MessagingRegistry } from '@kernlize/messaging';
import { buildShellCapabilities, createShellBridge, type ShellAdapter, type ShellBridge } from '@kehto/shell';
import { createGuardConfig, describeMitigations, type GuardEvent } from '@kernlize/guard';
import type { AppletIdentity, GuardFacade, Kernl, KernlOptions, RelayTiers, Session } from './types.js';
import { createKernlAccounts } from './applesauce/accounts.js';
import { isReadOnlyAccount } from './applesauce/auth-hooks.js';
import { createReplaceableLoader } from './applesauce/identity-providers.js';
import { createRelayTiers } from './relays/tiers.js';
import { decodePointer } from './applets/pointer.js';
import { defaultFetchBlob, openDefaultArtifactCache } from './applets/resolve.js';
import type { MountedApplet } from './applets/mount.js';
import { createGuardPipeline, type GuardPipeline } from './guard/pipeline.js';
import { applyRuntimeFirewallProfile, applyRuntimeFirewallRules, createRuntimeFirewallHooks } from './guard/runtime-rules.js';
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
import { createKernlServices, isTheme } from './kernl-services.js';
import { createShellAdapter } from './kernl-adapter.js';
import { createAppletLifecycle } from './kernl-lifecycle.js';
import { createKernlIntents } from './kernl-intents.js';
import { loadCatalog } from './catalog/fetch.js';

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
export function toSession(account: IAccount): Session {
  const metadata = account.metadata as { name?: unknown } | undefined;
  const label = typeof metadata?.name === 'string' ? metadata.name : (account.name ?? abbreviate(account.pubkey));
  return { accountId: account.id, pubkey: account.pubkey, label, readOnly: isReadOnlyAccount(account) };
}

interface ShellState {
  readonly pipeline: GuardPipeline;
  readonly bridge: ShellBridge;
  readonly handles: ReadonlyMap<string, MountedApplet>;
  readonly accounts: AccountManager;
  readonly session$: BehaviorSubject<Session | null>;
}

/** Keep the runtime firewall on the guard's profile and the session on the active account. */
function followShellState({ pipeline, bridge, handles, accounts, session$ }: ShellState): Subscription {
  const subscriptions = new Subscription();
  subscriptions.add(pipeline.profile$.subscribe(() => {
    applyRuntimeFirewallProfile(bridge.runtime.firewallState, pipeline.config);
    for (const handle of handles.values()) applyRuntimeFirewallRules(bridge.runtime.firewallState, pipeline.config, handle.summary.identity.dTag);
  }));
  subscriptions.add(accounts.active$.subscribe((account) => {
    session$.next(account ? toSession(account) : null);
    bridge.publishIdentityChanged(account?.pubkey ?? '');
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

/** The host's messaging and bridge registries, or kernl's defaults over the shell's parts. */
function registriesFor(options: KernlOptions, parts: MessagingParts): Pick<Kernl, 'messaging' | 'bridges'> {
  const { host } = options;
  return {
    messaging: options.messaging ?? createAccountMessaging(options, parts),
    // host.openLink asks before leaving kernl, so every hand-off is confirmed by the user (D-010).
    bridges: options.bridges ?? createDefaultBridges({ handoff: (uri) => host.openLink(uri), ...(options.torrent ? { torrent: options.torrent } : {}) }),
  };
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
  const pool = options.pool ?? new RelayPool();
  const accounts = options.accounts ?? createKernlAccounts(host.storage);
  const tiers = createRelayTiers(host.storage, options.relays ?? {});
  const { messaging, bridges } = registriesFor(options, { eventStore, pool, tiers, accounts });

  const handles = new Map<string, MountedApplet>();
  const guardEvents$ = new Subject<GuardEvent>();
  const session$ = new BehaviorSubject<Session | null>(null);
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
  const lookupBefore = lookupReplaceable(eventStore, {
    loader: createReplaceableLoader(eventStore, pool, tiers),
    relays: () => [...tiers.get().outbox, ...tiers.get().discovery],
  });
  const consent = createSigningConsent({ host, lookupBefore, resolveApplet: identityOf, pubkey: () => accounts.active?.pubkey });
  const services = createKernlServices({
    pool,
    tiers,
    eventStore,
    auth: { getSigner: () => adapter.auth.getSigner(), getUserPubkey: () => adapter.auth.getUserPubkey() },
    consent,
    host,
    bridges,
    messaging,
    ...(isTheme(options.theme) ? { theme: options.theme } : {}),
    resolveIdentity(windowId) {
      const identity = identityOf(windowId);
      return identity ? { dTag: identity.dTag, aggregateHash: identity.hash } : null;
    },
  });

  const intents = createKernlIntents({ host, pool, tiers, accounts, handles, ...(options.intentRetry ? { retry: options.intentRetry } : {}) });
  services.registry.intent = intents.handler;
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
    runtimeFirewall: createRuntimeFirewallHooks({
      storage: host.storage,
      onEvent: (event) => guardEvents$.next(event),
      ...(host.now ? { now: host.now.bind(host) } : {}),
    }),
  });
  const bridge = createShellBridge(adapter);
  grants = createGrants({ acl: bridge.runtime.aclState, storage: host.storage, availableDomains: () => buildShellCapabilities(adapter).domains });
  bridge.registerConsentHandler(createConsentHandler(host, lookupBefore, identityOf));

  subscriptions.add(followShellState({ pipeline, bridge, handles, accounts, session$ }));

  const lifecycle = createAppletLifecycle({
    pool,
    tiers,
    adapter,
    bridge,
    pipeline,
    grants,
    installed: intents.installed,
    host,
    handles,
    subscriptions,
    openCache: options.artifactCache ?? openDefaultArtifactCache,
    fetchBlob: host.fetchBlob ? host.fetchBlob.bind(host) : defaultFetchBlob,
    builtins: options.builtins ?? [],
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
    catalog: { load: (loadOptions) => loadCatalog(pool, tiers, loadOptions) },
    intents: intents.intents,
    session$,
    get session() {
      return session$.value;
    },
    ...createSignIn(accounts),
    decodePointer,
    ...lifecycle,
    destroy() {
      const open = [...handles.values()];
      for (const handle of open) handle.close();
      subscriptions.unsubscribe();
      intents.close();
      services.dm.dispose();
      bridge.destroy();
      if (ownsMessaging) messaging.close();
      if (ownsPool) pool.close();
    },
  };
}
