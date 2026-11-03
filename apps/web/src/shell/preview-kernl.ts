import { AccountManager, type IAccount } from 'applesauce-accounts';
import { registerCommonAccountTypes } from 'applesauce-accounts/accounts';
import { createBridgeRegistry, createHttpBridge, createMailBridge, createNzbBridge, createSoulseekBridge, createTorrentBridge } from '@kernl/bridges';
import {
  createAppletCsp,
  createGuardConfig,
  createIngressGuard,
  createVisibilityGate,
  describeMitigations,
  renderCsp,
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
import { BASELINE_DOMAINS, createPreviewGrants, createPreviewRelays } from './preview-state';

const PROFILE_KEY = 'kernl:preview:guard-profile:v1';
const PREVIEW_OWNER = 'e8f1a4b7c9d2e5f8a1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1d4e7f0';

interface Mounted {
  readonly plan: MountPlan;
  readonly frame: FrameLike;
  readonly handle: AppletHandle;
  readonly status$: BehaviorSubject<AppletStatus>;
}

interface PreviewMessage {
  readonly kernlPreview: string;
  readonly text?: string;
  readonly url?: string;
}

const ENVELOPES: Readonly<Record<string, { type: string; kind?: number }>> = {
  hello: { type: 'shell.ready' },
  publish: { type: 'relay.publish', kind: 1 },
  delete: { type: 'relay.publish', kind: 5 },
  notify: { type: 'notify.show' },
  subscribe: { type: 'relay.subscribe' },
  link: { type: 'link.open' },
};

function isPreviewMessage(data: unknown): data is PreviewMessage {
  return typeof data === 'object' && data !== null && typeof (data as PreviewMessage).kernlPreview === 'string';
}

function readProfile(host: KernlHost): GuardProfile {
  const stored = host.storage.getItem(PROFILE_KEY);
  return stored === 'balanced' || stored === 'relaxed' ? stored : 'strict';
}

interface PreviewGuard extends GuardFacade {
  ingress(): IngressGuard;
  gate(): VisibilityGate;
}

function createPreviewGuard(host: KernlHost): PreviewGuard {
  const events$ = new Subject<GuardEvent>();
  const profile$ = new BehaviorSubject<GuardProfile>(readProfile(host));
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
      host.storage.setItem(PROFILE_KEY, profile);
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
  reply(entry: Mounted, ok: boolean, text: string): void;
}

/** What the preview applet may ask for, gated by the grants in its mount plan. */
function createActions(host: KernlHost, pubkeyOf: () => string): Actions {
  const reply = (entry: Mounted, ok: boolean, text: string): void => {
    entry.frame.contentWindow?.postMessage({ kernlPreview: 'result', ok, text }, '*');
  };

  const consent = (entry: Mounted, summary: Omit<ConsentSummary, 'applet' | 'event'>, content: string, kind: number): void => {
    const now = Math.floor(Date.now() / 1000);
    const event = { id: '0'.repeat(64), pubkey: pubkeyOf(), created_at: now, kind, tags: [], content, sig: '' };
    host.presentConsent({
      summary: { ...summary, applet: entry.plan.summary.identity, event },
      resolve: (allowed) => reply(entry, allowed, allowed ? `${summary.title}: done (preview).` : `${summary.title}: you said no.`),
    });
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
        if (needs('relay')) consent(entry, { title: 'Publish a note', severity: 'routine', lines: [{ label: 'Note', after: text }] }, text, 1);
        return;
      case 'delete':
        if (needs('relay')) consent(entry, { title: 'Delete a note', severity: 'destructive', lines: [{ label: 'Note', before: text, after: 'removed' }] }, text, 5);
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
      default:
        reply(entry, false, `Unknown request ${message.kernlPreview}.`);
    }
  };

  return { perform, reply };
}

/** Mount order: sandbox, register, srcdoc. Closing removes the frame and forgets the window in the guard. */
function createMounter(guard: PreviewGuard, mounted: Map<string, Mounted>): (plan: MountPlan, frame: FrameLike) => AppletHandle {
  return (plan, frame) => {
    const status$ = new BehaviorSubject<AppletStatus>('mounting');
    const handle: AppletHandle = {
      windowId: plan.windowId,
      summary: plan.summary,
      status$,
      get status() {
        return status$.value;
      },
      setVisibility: (visibility: WindowVisibility) => guard.gate().setVisibility(plan.windowId, visibility),
      close() {
        if (status$.value === 'closed') return;
        status$.next('closed');
        mounted.delete(plan.windowId);
        guard.ingress().forget(plan.windowId);
        guard.gate().forget(plan.windowId);
        frame.remove();
      },
    };
    frame.setAttribute('sandbox', plan.sandbox);
    mounted.set(plan.windowId, { plan, frame, handle, status$ });
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
export function createPreviewKernl(host: KernlHost): ShellKernl {
  const accounts = new AccountManager();
  registerCommonAccountTypes(accounts);
  const guard = createPreviewGuard(host);
  const grants = createPreviewGrants(host.storage);
  const relays = createPreviewRelays(host.storage);
  const messaging = createPreviewMessaging(host.storage, PREVIEW_OWNER);
  const bridges = createBridgeRegistry();
  for (const bridge of [createHttpBridge(), createTorrentBridge(), createNzbBridge(), createSoulseekBridge(), createMailBridge()]) bridges.register(bridge);
  const session$ = new BehaviorSubject<Session | null>(null);
  const mounted = new Map<string, Mounted>();
  let windowCount = 0;

  const environmentFor = (summary: AppletSummary): readonly string[] => {
    const granted = grants.get(summary.identity)?.domains ?? [];
    return [...new Set([...BASELINE_DOMAINS, ...granted])];
  };

  const { perform, reply } = createActions(host, () => session$.value?.pubkey ?? PREVIEW_OWNER);
  const mount = createMounter(guard, mounted);

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
      return summary;
    },
    async plan(summary) {
      if (grants.get(summary.identity)?.blocked) throw new Error('denied:blocked');
      const domains = environmentFor(summary);
      windowCount += 1;
      return {
        windowId: `preview-${windowCount}`,
        summary,
        srcdoc: renderPreviewApplet({
          title: summary.title,
          csp: renderCsp(createAppletCsp(guard.config.profile).directives),
          domains,
          domainLabels: domains.filter((domain) => !BASELINE_DOMAINS.includes(domain)).map(domainLabel),
          identity: shortId(summary.identity.hash),
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
      const disposition = guard.ingress().admit(entry.plan.windowId, entry.plan.summary.identity.dTag, envelope, visibility);
      if (disposition === 'pass') perform(entry, event.data);
      else if (event.data.kernlPreview !== 'subscribe') reply(entry, false, `The guard held that request (${disposition}).`);
    },
    destroy() {
      for (const entry of mounted.values()) entry.handle.close();
      messaging.close();
    },
  };
}
