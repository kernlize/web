import { AccountManager, type IAccount } from 'applesauce-accounts';
import { registerCommonAccountTypes } from 'applesauce-accounts/accounts';
import {
  createBridgeRegistry,
  createHandoffBackends,
  createHttpBridge,
  createMailBridge,
  createNzbBridge,
  createSoulseekBridge,
  createTorrentBridge,
  type BridgeRegistry,
  type TorrentBackend,
} from '@kernlize/bridges';
import type { NappletCspDirectives } from '@kehto/shell';
import {
  createAppletCsp,
  createGuardConfig,
  createIngressGuard,
  createVisibilityGate,
  describeMitigations,
  type GuardEvent,
  type GuardProfile,
  type IngressGuard,
  type VisibilityGate,
  type WindowVisibility,
} from '@kernlize/guard';
import { BehaviorSubject, of, Subject } from 'rxjs';
import type {
  AppletHandle,
  AppletPointer,
  AppletStatus,
  AppletSummary,
  BuiltinApplet,
  ConsentSummary,
  FrameLike,
  GuardFacade,
  KernlHost,
  MountPlan,
  Session,
  ShellKernl,
} from './contract';
import { abbreviate, shortId } from './contract';
import { domainLabel } from './domains';
import { PREVIEW_CATALOG, PREVIEW_PUBLISHER, renderPreviewApplet, sampleSummary, sealPreviewDocument } from './preview-applet';
import { createPreviewBuiltins } from './preview-builtin';
import { PORT_DOMAINS, createPreviewPorts, type PortLike, type PreviewPorts } from './preview-port';
import { createPreviewIntents, type PreviewIntentDeps, type PreviewIntents } from './preview-intents';
import { createPreviewMessaging, PREVIEW_CORRESPONDENT } from './preview-messaging';
import { createPreviewDirectory, createPreviewMailboxes } from './preview-mailboxes';
import { createPreviewProfiles } from './preview-profiles';
import type { ShellTheme } from './shell-theme';
import { baselineDomains, createPreviewGrants, createPreviewRelays, loadBaselineDomains } from './preview-state';

export const PREVIEW_OWNER = 'e8f1a4b7c9d2e5f8a1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1d4e7f0';

interface Mounted {
  readonly plan: MountPlan;
  readonly frame: FrameLike;
  readonly handle: AppletHandle;
  readonly status$: BehaviorSubject<AppletStatus>;
  /** Stop the applet for a reason the user is told about, as the live mount does. */
  readonly revoke: (reason: string) => void;
  /** Set once an applet that speaks over a real port has handed it over. */
  unbind?: () => void;
}

interface PreviewMessage {
  readonly kernlPreview: string;
  readonly text?: string;
  readonly url?: string;
}

const SAMPLE_NOTE_ID = 'c0ffee00'.repeat(8);

/** A preview applet answers at once, so delivery gives up after five seconds rather than the live shell's fifteen. */
const PREVIEW_INTENT_RETRY = { intervalMs: 100, attempts: 50 } as const;
const SAMPLE_CONTACT = 'decade00'.repeat(8);

interface Draft {
  readonly kind: number;
  readonly content: string;
  readonly tags: string[][];
}

/** What the sample buttons that ask first would sign, beyond the profile and the deletion. */
const SAMPLE_DRAFTS: Readonly<Record<string, Draft>> = {
  contacts: { kind: 3, content: '', tags: [['p', SAMPLE_CONTACT, 'wss://relay.damus.io', 'alex']] },
  servers: { kind: 10002, content: '', tags: [['r', 'wss://nos.lol'], ['r', 'wss://relay.damus.io', 'write']] },
  vanish: { kind: 62, content: 'Please erase everything.', tags: [['relay', 'wss://relay.damus.io']] },
};

const ENVELOPES: Readonly<Record<string, { type: string; kind?: number }>> = {
  hello: { type: 'shell.ready' },
  publish: { type: 'relay.publish', kind: 1 },
  profile: { type: 'relay.publish', kind: 0 },
  delete: { type: 'relay.publish', kind: 5 },
  contacts: { type: 'relay.publish', kind: 3 },
  servers: { type: 'relay.publish', kind: 10002 },
  vanish: { type: 'relay.publish', kind: 62 },
  notify: { type: 'notify.show' },
  subscribe: { type: 'relay.subscribe' },
  link: { type: 'link.open' },
  intent: { type: 'intent.invoke' },
};

/** What a host can change about the preview. */
export interface PreviewOptions {
  /** How long delivery of a request to another applet keeps trying. */
  readonly intentRetry?: PreviewIntentDeps['retry'];
  /** Applets the shell ships, opened from their real bytes. */
  readonly builtins?: readonly BuiltinApplet[];
  /** The shell's colours, for applets that ask for the theme. */
  readonly theme?: ShellTheme;
}

const isHello = (data: unknown): boolean => typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'napplet.hello';

/** What a built-in applet's hello needs: the port it handed over, and the guard that looks at every envelope on it. */
interface PortDeps {
  readonly ports: PreviewPorts;
  readonly guard: PreviewGuard;
  readonly host: Pick<KernlHost, 'getVisibility'>;
}

/**
 * Take a built-in applet's port. A second hello, or one without a port, is ignored: the first
 * binding stands, as it does in the live shell. Like the samples, the guard records what it sees
 * and only a quarantine stops the applet (D-011).
 */
function bindPort(entry: Mounted, event: MessageEvent, deps: PortDeps): void {
  const port = event.ports?.[0] as PortLike | undefined;
  if (!isHello(event.data) || !port || entry.unbind) return;
  const { windowId, summary, environment } = entry.plan;
  entry.unbind = deps.ports.bind({
    windowId,
    port,
    domains: environment.capabilities.domains,
    admit(envelope) {
      if (deps.guard.ingress().admit(windowId, summary.identity.dTag, envelope, deps.host.getVisibility(windowId)) !== 'quarantine') return true;
      entry.revoke('quarantine');
      return false;
    },
  });
  entry.status$.next('running');
}

function isPreviewMessage(data: unknown): data is PreviewMessage {
  return typeof data === 'object' && data !== null && typeof (data as PreviewMessage).kernlPreview === 'string';
}

interface PreviewGuard extends GuardFacade {
  ingress(): IngressGuard;
  gate(): VisibilityGate;
}

/** Like the live shell (D-003): every page load starts strict, and a change lasts until reload. */
function createPreviewGuard(): PreviewGuard {
  const events$ = new Subject<GuardEvent>();
  const profile$ = new BehaviorSubject<GuardProfile>('strict');
  const emit = (event: GuardEvent): void => events$.next(event);
  let config = createGuardConfig(profile$.value);
  let ingress = createIngressGuard({ config, onEvent: emit });
  let gate = createVisibilityGate({ config, onEvent: emit });
  return {
    get config() {
      return config;
    },
    profile$,
    setProfile(profile) {
      config = createGuardConfig(profile);
      ingress = createIngressGuard({ config, onEvent: emit });
      gate = createVisibilityGate({ config, onEvent: emit });
      profile$.next(profile);
    },
    events$,
    mitigations: () => describeMitigations(config),
    release: (windowId) => ingress.release(windowId),
    ingress: () => ingress,
    gate: () => gate,
  };
}

interface Actions {
  perform(entry: Mounted, message: PreviewMessage): void;
}

/** What the preview applet may ask for, gated by the grants in its mount plan. */
function createActions(host: KernlHost, bridges: BridgeRegistry, pubkeyOf: () => string, intents: PreviewIntents): Actions {
  const reply = (entry: Mounted, ok: boolean, text: string): void => {
    entry.frame.contentWindow?.postMessage({ kernlPreview: 'result', ok, text }, '*');
  };

  /**
   * The live shell's rule, from the core itself: only destructive kinds wait for the user, routine
   * publishes go straight out. Imported on first use so the core stays out of the shell's first chunk.
   */
  const publish = async (entry: Mounted, draft: Draft): Promise<void> => {
    const { describeChange, isDestructiveKind } = await import('@kernlize/core');
    const now = Math.floor(Date.now() / 1000);
    const event = { id: '0'.repeat(64), pubkey: pubkeyOf(), created_at: now, sig: '', ...draft };
    const summary: ConsentSummary = describeChange(event, undefined, entry.plan.summary.identity);
    if (!isDestructiveKind(draft.kind)) {
      reply(entry, true, `${summary.title}: done (preview).`);
      return;
    }
    host.presentConsent({
      summary,
      resolve: (allowed) => reply(entry, allowed, allowed ? `${summary.title}: done (preview).` : `${summary.title}: you said no.`),
    });
  };

  /** A shared download resolves through the same bridges the live shell uses (D-010, D-017). */
  const handOff = async (entry: Mounted, url: string): Promise<void> => {
    const { dTag, hash } = entry.plan.summary.identity;
    try {
      const result = await bridges.resolve(url, { requester: { dTag, hash } });
      const handedOff = 'id' in result && result.id.startsWith('handoff:');
      reply(entry, true, handedOff ? 'Handed to an app on your device.' : 'Added to your downloads.');
    } catch {
      reply(entry, false, 'The download could not be handed off.');
    }
  };

  const perform = (entry: Mounted, message: PreviewMessage): void => {
    const domains = entry.plan.environment.capabilities.domains;
    const needs = (domain: string): boolean => {
      if (domains.includes(domain)) return true;
      reply(entry, false, `Refused: this applet has no grant for ${domainLabel(domain)}.`);
      return false;
    };
    const text = message.text ?? '';
    switch (message.kernlPreview) {
      case 'hello':
        entry.status$.next('running');
        reply(entry, true, 'Connected to the shell.');
        return;
      case 'publish':
        if (needs('relay')) void publish(entry, { kind: 1, content: text, tags: [] });
        return;
      case 'profile':
        if (needs('relay')) void publish(entry, { kind: 0, content: JSON.stringify({ name: text }), tags: [] });
        return;
      case 'delete':
        if (needs('relay')) void publish(entry, { kind: 5, content: '', tags: [['e', SAMPLE_NOTE_ID]] });
        return;
      case 'contacts':
      case 'servers':
      case 'vanish':
        if (needs('relay')) void publish(entry, SAMPLE_DRAFTS[message.kernlPreview] as Draft);
        return;
      case 'notify':
        if (needs('notify')) {
          host.notify({ title: entry.plan.summary.title, body: text, windowId: entry.plan.windowId, tone: 'info' });
          reply(entry, true, 'Notification shown.');
        }
        return;
      case 'subscribe':
        needs('relay');
        return;
      case 'intent':
        if (needs('intent')) {
          const request = { sender: entry.plan.summary.manifest.catalogId, archetype: 'profile', action: 'open', payload: { pubkey: text } };
          void intents.invoke(request).then((result) => reply(entry, result.ok, result.text));
        }
        return;
      case 'link':
        if (message.url?.startsWith('https://')) host.openLink(message.url);
        return;
      case 'download':
        void handOff(entry, message.url ?? '');
        return;
      default:
        reply(entry, false, `Unknown request ${message.kernlPreview}.`);
    }
  };

  return { perform };
}

/** Mount order: sandbox, register, srcdoc. Closing or revoking removes the frame and forgets the window in the guard. */
function createMounter(host: KernlHost, guard: PreviewGuard, mounted: Map<string, Mounted>): (plan: MountPlan, frame: FrameLike) => AppletHandle {
  return (plan, frame) => {
    const status$ = new BehaviorSubject<AppletStatus>('mounting');
    const teardown = (status: AppletStatus): void => {
      status$.next(status);
      mounted.get(plan.windowId)?.unbind?.();
      mounted.delete(plan.windowId);
      guard.ingress().forget(plan.windowId);
      guard.gate().forget(plan.windowId);
      frame.remove();
    };
    const handle: AppletHandle = {
      windowId: plan.windowId,
      summary: plan.summary,
      status$,
      get status() {
        return status$.value;
      },
      setVisibility: (visibility: WindowVisibility) => guard.gate().setVisibility(plan.windowId, visibility),
      close() {
        if (status$.value === 'closed' || status$.value === 'revoked') return;
        teardown('closed');
      },
    };
    const revoke = (reason: string): void => {
      if (status$.value === 'closed' || status$.value === 'revoked') return;
      teardown('revoked');
      host.onRevoked(plan.windowId, reason);
    };
    frame.setAttribute('sandbox', plan.sandbox);
    mounted.set(plan.windowId, { plan, frame, handle, status$, revoke });
    frame.srcdoc = plan.srcdoc;
    return handle;
  };
}

function sessionOf(account: IAccount): Session {
  const name = (account.metadata as { name?: string } | undefined)?.name;
  return { accountId: account.id, pubkey: account.pubkey, label: name ?? abbreviate(account.pubkey), readOnly: account.type === 'readonly' };
}

/** The live shell's bridges, with the same confirm-before-leaving opener as its createKernl wiring. */
function createPreviewBridges(host: KernlHost, torrent: TorrentBackend | undefined): BridgeRegistry {
  const bridges = createBridgeRegistry();
  const handoff = createHandoffBackends((uri) => host.openLink(uri));
  for (const bridge of [
    createHttpBridge(),
    createTorrentBridge(torrent ?? handoff.torrent),
    createNzbBridge(handoff.nzb),
    createSoulseekBridge(handoff.soulseek),
    createMailBridge(handoff.mail),
  ])
    bridges.register(bridge);
  return bridges;
}

interface PreviewDocument {
  readonly summary: AppletSummary;
  /** The checked bytes of an applet the shell ships; undefined for a sample. */
  readonly shipped: string | undefined;
  readonly profile: GuardProfile;
  readonly domains: readonly string[];
  readonly baseline: readonly string[];
}

/** The sealed document for a plan: an applet's real bytes when the shell ships it, the sample page otherwise. */
function previewDocument({ summary, shipped, profile, domains, baseline }: PreviewDocument): string {
  const guardCsp = createAppletCsp(profile);
  const csp = { connectOrigins: guardCsp.connectOrigins, directives: guardCsp.directives as NappletCspDirectives };
  if (shipped !== undefined) return sealPreviewDocument(shipped, { csp, domains });
  return renderPreviewApplet({
    title: summary.title,
    csp,
    domains,
    domainLabels: domains.filter((domain) => !baseline.includes(domain)).map(domainLabel),
    identity: shortId(summary.identity.hash),
    sample: summary.identity.dTag,
  });
}

/**
 * The shell with nothing behind it: real guard, grants, messaging, bridge
 * and intent-routing packages over in-memory state, a store that lists the
 * preview's own applets, and a static applet document instead of verified
 * bytes. Default when the live core is absent,
 * and the thing Playwright drives.
 */
export function createPreviewKernl(host: KernlHost, torrent?: TorrentBackend, options: PreviewOptions = {}): ShellKernl {
  const { intentRetry = PREVIEW_INTENT_RETRY, builtins = [], theme } = options;
  const accounts = new AccountManager();
  registerCommonAccountTypes(accounts);
  const guard = createPreviewGuard();
  const grants = createPreviewGrants(host.storage);
  const relays = createPreviewRelays(host.storage);
  const messaging = createPreviewMessaging(host.storage, PREVIEW_OWNER, host.chooseReply?.bind(host));
  const shipped = createPreviewBuiltins(builtins, grants);
  const bridges = createPreviewBridges(host, torrent);
  const session$ = new BehaviorSubject<Session | null>(null);
  const profiles = createPreviewProfiles({ [PREVIEW_OWNER]: 'Preview account', [PREVIEW_CORRESPONDENT]: 'Ada', [PREVIEW_PUBLISHER]: 'kernl samples' });
  const mounted = new Map<string, Mounted>();
  let windowCount = 0;

  const environmentFor = (summary: AppletSummary): readonly string[] => {
    const granted = grants.get(summary.identity)?.domains ?? [];
    return [...new Set([...baselineDomains(), ...granted])];
  };

  const intents = createPreviewIntents({
    storage: host.storage,
    host,
    findWindow: (catalogId) => [...mounted.values()].find((entry) => entry.plan.summary.manifest.catalogId === catalogId)?.plan.windowId,
    deliver(windowId, text) {
      const entry = mounted.get(windowId);
      // Like the live runtime: only a running applet that holds the grant receives a request.
      if (!entry || entry.status$.value !== 'running' || !entry.plan.environment.capabilities.domains.includes('intent')) return false;
      entry.frame.contentWindow?.postMessage({ kernlPreview: 'delivery', text }, '*');
      return true;
    },
    retry: intentRetry,
  });
  const pubkey = (): string => session$.value?.pubkey ?? PREVIEW_OWNER;
  const { perform } = createActions(host, bridges, pubkey, intents);
  const mount = createMounter(host, guard, mounted);
  const ports = createPreviewPorts({ messaging, pubkey: () => PREVIEW_OWNER, notify: (notice) => host.notify(notice), ...(theme ? { theme: { initialTheme: theme } } : {}) });

  return {
    accounts,
    guard,
    grants,
    relays,
    messaging,
    bridges,
    catalog: { load: async () => PREVIEW_CATALOG, stream: () => of(PREVIEW_CATALOG) },
    profiles,
    mailboxes: createPreviewMailboxes(),
    directory: createPreviewDirectory(),
    intents: intents.intents,
    session$,
    get session() {
      return session$.value;
    },
    async login(account) {
      if (!accounts.getAccount(account.id)) accounts.addAccount(account);
      accounts.setActive(account);
      const session = sessionOf(account);
      session$.next(session);
      return session;
    },
    async logout() {
      for (const entry of mounted.values()) entry.handle.close();
      accounts.clearActive();
      session$.next(null);
    },
    decodePointer(input) {
      const trimmed = input.trim();
      if (!trimmed) throw new Error('invalid:pointer');
      const builtin = shipped.decode(trimmed);
      if (builtin) return builtin;
      const sample = sampleSummary(trimmed);
      if (sample) return { kind: 'address', pubkey: sample.publisher, identifier: sample.identity.dTag, eventKind: sample.manifest.kind, relays: [] };
      return { kind: 'event', id: trimmed, relays: [] };
    },
    async resolve(pointer: AppletPointer) {
      if (pointer.kind === 'builtin') {
        await loadBaselineDomains();
        return shipped.resolve(pointer.id);
      }
      const summary = pointer.kind === 'address' ? sampleSummary(`preview:${pointer.identifier}`) : undefined;
      if (!summary) throw new Error('unavailable:preview-offline');
      await loadBaselineDomains();
      return summary;
    },
    install: (summary) => intents.installed.install(summary),
    async plan(summary) {
      if (grants.get(summary.identity)?.blocked) throw new Error('denied:blocked');
      intents.installed.install(summary);
      const baseline = await loadBaselineDomains();
      const document = shipped.documentOf(summary);
      // A real applet is offered only what the preview can answer over its port, so nothing it calls hangs.
      const domains = document === undefined ? environmentFor(summary) : environmentFor(summary).filter((domain) => PORT_DOMAINS.includes(domain));
      windowCount += 1;
      return {
        windowId: `preview-${windowCount}`,
        summary,
        srcdoc: previewDocument({ summary, shipped: document, profile: guard.config.profile, domains, baseline }),
        sandbox: 'allow-scripts',
        environment: { capabilities: { domains }, services: [] },
        missingRequired: summary.requires.filter((domain) => !domains.includes(domain)),
      };
    },
    mount,
    applets: () => [...mounted.values()].map((entry) => entry.handle),
    handleWindowMessage(event) {
      const entry = [...mounted.values()].find((candidate) => candidate.frame.contentWindow === event.source);
      if (entry?.plan.summary.builtin) return bindPort(entry, event, { ports, guard, host });
      if (!entry || !isPreviewMessage(event.data)) return;
      const envelope = ENVELOPES[event.data.kernlPreview] ?? { type: 'generic' };
      const visibility = host.getVisibility(entry.plan.windowId);
      // The preview's sample applets talk over window messages, not a bound port, so its guard
      // records what it sees and holds nothing back; only a quarantine stops the applet (D-011).
      const disposition = guard.ingress().admit(entry.plan.windowId, entry.plan.summary.identity.dTag, envelope, visibility);
      if (disposition === 'quarantine') entry.revoke('quarantine');
      else perform(entry, event.data);
    },
    destroy() {
      for (const entry of mounted.values()) entry.handle.close();
      ports.close();
      messaging.close();
    },
  };
}
