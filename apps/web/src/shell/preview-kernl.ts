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
} from '@kernl/bridges';
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
} from '@kernl/guard';
import { BehaviorSubject, Subject } from 'rxjs';
import type {
  AppletHandle,
  AppletPointer,
  AppletStatus,
  AppletSummary,
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
import { renderPreviewApplet, sampleSummary } from './preview-applet';
import { createPreviewMessaging } from './preview-messaging';
import { baselineDomains, createPreviewGrants, createPreviewRelays, loadBaselineDomains } from './preview-state';

const PREVIEW_OWNER = 'e8f1a4b7c9d2e5f8a1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1d4e7f0';

interface Mounted {
  readonly plan: MountPlan;
  readonly frame: FrameLike;
  readonly handle: AppletHandle;
  readonly status$: BehaviorSubject<AppletStatus>;
  /** Stop the applet for a reason the user is told about, as the live mount does. */
  readonly revoke: (reason: string) => void;
}

interface PreviewMessage {
  readonly kernlPreview: string;
  readonly text?: string;
  readonly url?: string;
}

const SAMPLE_NOTE_ID = 'c0ffee00'.repeat(8);
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
};

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
function createActions(host: KernlHost, bridges: BridgeRegistry, pubkeyOf: () => string): Actions {
  const reply = (entry: Mounted, ok: boolean, text: string): void => {
    entry.frame.contentWindow?.postMessage({ kernlPreview: 'result', ok, text }, '*');
  };

  /**
   * The live shell's rule, from the core itself: only destructive kinds wait for the user, routine
   * publishes go straight out. Imported on first use so the core stays out of the shell's first chunk.
   */
  const publish = async (entry: Mounted, draft: Draft): Promise<void> => {
    const { describeChange, isDestructiveKind } = await import('@kernl/core');
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

/**
 * The shell with nothing behind it: real guard, grants, messaging and bridge
 * packages over in-memory state, two sample applets, and a static applet
 * document instead of verified bytes. Default when the live core is absent,
 * and the thing Playwright drives.
 */
export function createPreviewKernl(host: KernlHost, torrent?: TorrentBackend): ShellKernl {
  const accounts = new AccountManager();
  registerCommonAccountTypes(accounts);
  const guard = createPreviewGuard();
  const grants = createPreviewGrants(host.storage);
  const relays = createPreviewRelays(host.storage);
  const messaging = createPreviewMessaging(host.storage, PREVIEW_OWNER);
  const bridges = createBridgeRegistry();
  // The same confirm-before-leaving opener as the live shell's createKernl wiring.
  const handoff = createHandoffBackends((uri) => host.openLink(uri));
  for (const bridge of [
    createHttpBridge(),
    createTorrentBridge(torrent ?? handoff.torrent),
    createNzbBridge(handoff.nzb),
    createSoulseekBridge(handoff.soulseek),
    createMailBridge(handoff.mail),
  ])
    bridges.register(bridge);
  const session$ = new BehaviorSubject<Session | null>(null);
  const mounted = new Map<string, Mounted>();
  let windowCount = 0;

  const environmentFor = (summary: AppletSummary): readonly string[] => {
    const granted = grants.get(summary.identity)?.domains ?? [];
    return [...new Set([...baselineDomains(), ...granted])];
  };

  const { perform } = createActions(host, bridges, () => session$.value?.pubkey ?? PREVIEW_OWNER);
  const mount = createMounter(host, guard, mounted);

  return {
    accounts,
    guard,
    grants,
    relays,
    messaging,
    bridges,
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
      const sample = sampleSummary(trimmed);
      if (sample) return { kind: 'address', pubkey: sample.publisher, identifier: sample.identity.dTag, eventKind: sample.manifest.kind, relays: [] };
      return { kind: 'event', id: trimmed, relays: [] };
    },
    async resolve(pointer: AppletPointer) {
      const summary = pointer.kind === 'address' ? sampleSummary(`preview:${pointer.identifier}`) : undefined;
      if (!summary) throw new Error('unavailable:preview-offline');
      await loadBaselineDomains();
      return summary;
    },
    async plan(summary) {
      if (grants.get(summary.identity)?.blocked) throw new Error('denied:blocked');
      const baseline = await loadBaselineDomains();
      const domains = environmentFor(summary);
      const csp = createAppletCsp(guard.config.profile);
      windowCount += 1;
      return {
        windowId: `preview-${windowCount}`,
        summary,
        srcdoc: renderPreviewApplet({
          title: summary.title,
          csp: { connectOrigins: csp.connectOrigins, directives: csp.directives as NappletCspDirectives },
          domains,
          domainLabels: domains.filter((domain) => !baseline.includes(domain)).map(domainLabel),
          identity: shortId(summary.identity.hash),
          sample: summary.identity.dTag,
        }),
        sandbox: 'allow-scripts',
        environment: { capabilities: { domains }, services: [] },
        missingRequired: summary.requires.filter((domain) => !domains.includes(domain)),
      };
    },
    mount,
    applets: () => [...mounted.values()].map((entry) => entry.handle),
    handleWindowMessage(event) {
      const entry = [...mounted.values()].find((candidate) => candidate.frame.contentWindow === event.source);
      if (!entry || !isPreviewMessage(event.data)) return;
      const envelope = ENVELOPES[event.data.kernlPreview] ?? { type: 'generic' };
      const visibility = host.getVisibility(entry.plan.windowId);
      // Observe-only, as the live shell is for applet traffic (D-012): the guard records what it
      // sees and holds nothing back; only a quarantine stops the applet.
      const disposition = guard.ingress().admit(entry.plan.windowId, entry.plan.summary.identity.dTag, envelope, visibility);
      if (disposition === 'quarantine') entry.revoke('quarantine');
      else perform(entry, event.data);
    },
    destroy() {
      for (const entry of mounted.values()) entry.handle.close();
      messaging.close();
    },
  };
}
