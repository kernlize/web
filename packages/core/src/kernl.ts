import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import type { IAccount } from 'applesauce-accounts';
import { buildShellCapabilities, createShellBridge, type ShellAdapter } from '@kehto/shell';
import { createGuardConfig, describeMitigations, type GuardEvent } from '@kernl/guard';
import type { AppletIdentity, GuardFacade, Kernl, KernlOptions, Session } from './types.js';
import { createKernlAccounts } from './applesauce/accounts.js';
import { isReadOnlyAccount } from './applesauce/auth-hooks.js';
import { createReplaceableLoader } from './applesauce/identity-providers.js';
import { createRelayTiers } from './relays/tiers.js';
import { decodePointer } from './applets/pointer.js';
import { defaultFetchBlob, openDefaultArtifactCache } from './applets/resolve.js';
import type { MountedApplet } from './applets/mount.js';
import { createGuardPipeline, type GuardPipeline } from './guard/pipeline.js';
import { refuseCurrentDispatch } from './guard/runtime-rules.js';
import { createEnvironmentResolver, createGrants, type KernlGrants } from './grants/grants.js';
import { createConsentHandler, createSigningConsent, lookupReplaceable } from './consent/handler.js';
import { abbreviate } from './consent/describe-change.js';
import { createDefaultMessaging } from './messaging/default-registry.js';
import { createDefaultBridges } from './bridges/default-registry.js';
import { createKernlServices, isTheme } from './kernl-services.js';
import { createShellAdapter } from './kernl-adapter.js';
import { createAppletLifecycle } from './kernl-lifecycle.js';

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

/**
 * Compose the shell: one `EventStore`, one `RelayPool`, one `AccountManager`,
 * the relay tiers, the guard pipeline, the grants layer, the messaging and
 * bridge registries, kehto's services and `createShellBridge`, plus the applet
 * lifecycle `decodePointer` → `resolve` → `plan` → `mount`.
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
  const eventStore = options.eventStore ?? new EventStore();
  const pool = options.pool ?? new RelayPool();
  const accounts = options.accounts ?? createKernlAccounts(host.storage);
  const tiers = createRelayTiers(host.storage, options.relays ?? {});
  const messaging = options.messaging ?? createDefaultMessaging({ storage: host.storage, ...(options.messagingBackends ? { backends: options.messagingBackends } : {}) });
  const bridges = options.bridges ?? createDefaultBridges();

  const handles = new Map<string, MountedApplet>();
  const guardEvents$ = new Subject<GuardEvent>();
  const session$ = new BehaviorSubject<Session | null>(null);
  const subscriptions = new Subscription();
  let grants: KernlGrants;

  const pipeline = createGuardPipeline({
    config: createGuardConfig(options.guard?.profile ?? 'strict'),
    ...(host.now ? { now: host.now.bind(host) } : {}),
    onEvent: (event) => {
      // The ingress guard's size caps are refused before dispatch through the runtime firewall (D-012).
      if (event.reason.startsWith('size:')) refuseCurrentDispatch(bridge.runtime.firewallState, event.napplet);
      guardEvents$.next(event);
    },
    onQuarantine: (windowId) => {
      handles.get(windowId)?.revoked('quarantine');
      bridge.revokeNapplet(windowId, 'host');
    },
    getVisibility: (windowId) => host.getVisibility(windowId),
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
    auth: { getSigner: () => adapter.auth.getSigner() },
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

  const adapter: ShellAdapter = createShellAdapter({
    pool,
    tiers,
    accounts,
    consent,
    services: services.registry,
    resolveEnvironment: (identity, available) => createEnvironmentResolver(grants)(identity, available),
    onNappletRevoked: ({ windowId, reason }) => handles.get(windowId)?.revoked(reason),
    onNappletMessage: (windowId, message) => pipeline.observe(windowId, identityOf(windowId)?.dTag ?? 'unknown', message),
  });
  const bridge = createShellBridge(adapter);
  grants = createGrants({ acl: bridge.runtime.aclState, storage: host.storage, availableDomains: () => buildShellCapabilities(adapter).domains });
  bridge.registerConsentHandler(createConsentHandler(host, lookupBefore, identityOf));

  subscriptions.add(accounts.active$.subscribe((account) => {
    session$.next(account ? toSession(account) : null);
    bridge.publishIdentityChanged(account?.pubkey ?? '');
  }));

  const lifecycle = createAppletLifecycle({
    pool,
    tiers,
    adapter,
    bridge,
    pipeline,
    grants,
    host,
    handles,
    subscriptions,
    openCache: options.artifactCache ?? openDefaultArtifactCache,
    fetchBlob: host.fetchBlob ? host.fetchBlob.bind(host) : defaultFetchBlob,
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
    session$,
    get session() {
      return session$.value;
    },
    async login(account) {
      if (!accounts.getAccount(account.id)) accounts.addAccount(account);
      accounts.setActive(account);
      return toSession(account);
    },
    async logout() {
      accounts.clearActive();
    },
    decodePointer,
    ...lifecycle,
    destroy() {
      const open = [...handles.values()];
      for (const handle of open) handle.close();
      subscriptions.unsubscribe();
      services.dm.dispose();
      bridge.destroy();
      if (ownsPool) pool.close();
    },
  };
}
