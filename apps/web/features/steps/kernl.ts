import { expect, vi } from 'vitest';
import { firstValueFrom, type Observable } from 'rxjs';
import { Given, Then, When } from 'quickpickle';
import type { IAccount } from 'applesauce-accounts';
import { PrivateKeyAccount, ReadonlyAccount } from 'applesauce-accounts/accounts';
import { BASELINE_DOMAINS } from '@kernlize/core';
import { MemoryStorage } from '../../../../packages/core/features/steps/world.ts';
import { abbreviate, type AppletHandle, type AppletPointer, type AppletSummary, type ConsentPrompt, type FrameLike, type HandlerPrompt, type KernlHost, type MountPlan, type ShellKernl } from '../../src/shell/contract.ts';
import { PREVIEW_PUBLISHER, sampleSummary } from '../../src/shell/preview-applet.ts';
import { PREVIEW_CORRESPONDENT } from '../../src/shell/preview-messaging.ts';
import { createShellDownloads } from '../../src/shell/downloads.ts';
import { createPreviewTorrentClient } from '../../src/shell/preview-downloads.ts';
import { createPreviewKernl, PREVIEW_OWNER } from '../../src/shell/preview-kernl.ts';
import './shell-host.ts';
import './preview-messaging.ts';

const READONLY_PUBKEY = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';

interface PreviewFrame extends FrameLike {
  readonly posts: Array<Record<string, unknown>>;
  readonly attributes: Map<string, string>;
  removed: boolean;
}

interface PreviewScratch {
  readonly kernl: ShellKernl;
  readonly prompts: ConsentPrompt[];
  readonly notices: unknown[];
  readonly links: string[];
  readonly revoked: Array<{ windowId: string; reason: string }>;
  readonly frames: Map<string, PreviewFrame>;
  readonly handles: Map<string, AppletHandle>;
  readonly asked: HandlerPrompt[];
  readonly opened: string[];
  readonly focused: string[];
  /** What the handler chooser does: install an applet from the store and pick it, or cancel. */
  pickFromStore?: string;
  openGhost: boolean;
  answer: boolean;
  account?: IAccount;
  pointer?: AppletPointer;
  summary?: AppletSummary;
  plan?: MountPlan;
  error?: Error;
}

interface PreviewWorld {
  previewKernl?: PreviewScratch;
}

function preview(world: PreviewWorld): PreviewScratch {
  if (!world.previewKernl) throw new Error('create a preview kernl first');
  return world.previewKernl;
}

/** Only `postMessage` is read; a null-prototype object stands in for the rest of `Window`. */
function fakeWindow(postMessage: (data: Record<string, unknown>) => void): Window {
  const win: Window = Object.create(null);
  return Object.assign(win, { postMessage });
}

function createPreviewFrame(detached: boolean): PreviewFrame {
  const posts: Array<Record<string, unknown>> = [];
  const attributes = new Map<string, string>();
  const win = detached ? null : fakeWindow((data) => void posts.push(data));
  const frame: PreviewFrame = {
    contentWindow: win,
    srcdoc: '',
    posts,
    attributes,
    removed: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setAttribute: (name, value) => void attributes.set(name, value),
    remove() {
      frame.removed = true;
    },
  };
  return frame;
}

function sample(name: string): AppletSummary {
  const summary = sampleSummary(`preview:${name}`);
  if (!summary) throw new Error(`no sample ${name}`);
  return summary;
}

async function capture(scratch: PreviewScratch, body: () => unknown): Promise<void> {
  scratch.error = undefined;
  try {
    await body();
  } catch (error) {
    scratch.error = error instanceof Error ? error : new Error(String(error));
  }
}

function current<T>(stream: Observable<T>): T | undefined {
  let latest: T | undefined;
  stream.subscribe((value) => (latest = value)).unsubscribe();
  return latest;
}

const list = (value: string): string[] => value.split(',').map((item) => item.trim()).filter(Boolean);

function frameOf(scratch: PreviewScratch, name: string): PreviewFrame {
  const frame = scratch.frames.get(name);
  if (!frame) throw new Error(`no frame ${name}`);
  return frame;
}

function handleOf(scratch: PreviewScratch, name: string): AppletHandle {
  const handle = scratch.handles.get(name);
  if (!handle) throw new Error(`no applet in frame ${name}`);
  return handle;
}

function post(scratch: PreviewScratch, name: string, data: unknown): void {
  scratch.kernl.handleWindowMessage({ source: frameOf(scratch, name).contentWindow, data } as MessageEvent);
}

/** The desktop's side of opening an intent target: mount it in a new frame, and let it say hello a moment later. */
async function openFromDesktop(world: PreviewWorld, address: string): Promise<string | undefined> {
  const scratch = preview(world);
  scratch.opened.push(address);
  if (scratch.openGhost) return 'ghost';
  const name = address.slice('preview:'.length);
  const frameName = `opened-${name}`;
  await mountInto(world, name, frameName, false);
  setTimeout(() => post(scratch, frameName, { kernlPreview: 'hello' }), 5);
  return handleOf(scratch, frameName).windowId;
}

function previewKernl(world: PreviewWorld, inKernl: boolean): void {
  const prompts: ConsentPrompt[] = [];
  const notices: unknown[] = [];
  const links: string[] = [];
  const revoked: Array<{ windowId: string; reason: string }> = [];
  const host: KernlHost = {
    storage: new MemoryStorage(),
    presentConsent(prompt) {
      prompts.push(prompt);
      prompt.resolve(scratch.answer);
    },
    notify: (notice) => void notices.push(notice),
    openLink: (url) => void links.push(url),
    getVisibility: () => ({ visible: true, focused: true }),
    onRevoked: (windowId, reason) => void revoked.push({ windowId, reason }),
    async chooseHandler(prompt) {
      scratch.asked.push(prompt);
      if (!scratch.pickFromStore) return undefined;
      return { id: scratch.kernl.install(sample(scratch.pickFromStore)).catalogId, remember: false };
    },
    openApplet: (address) => openFromDesktop(world, address),
    focusApplet: (windowId) => void scratch.focused.push(windowId),
  };
  const torrent = inKernl ? createShellDownloads({ storage: host.storage, client: createPreviewTorrentClient(() => () => undefined), open: host.openLink, inKernl }).torrent : undefined;
  const scratch: PreviewScratch = {
    kernl: createPreviewKernl(host, torrent, { intentRetry: { intervalMs: 2, attempts: 20 } }),
    prompts,
    notices,
    links,
    revoked,
    frames: new Map(),
    handles: new Map(),
    asked: [],
    opened: [],
    focused: [],
    openGhost: false,
    answer: true,
  };
  world.previewKernl = scratch;
}

Given('a preview kernl', (world: PreviewWorld) => previewKernl(world, false));

Given('a preview kernl that downloads in kernl', (world: PreviewWorld) => previewKernl(world, true));

Given('the preview kernl user will answer {string}', (world: PreviewWorld, answer: string) => {
  preview(world).answer = answer === 'yes';
});

Then('the preview kernl has no session', (world: PreviewWorld) => {
  const { kernl } = preview(world);
  expect(kernl.session).toBeNull();
  expect(kernl.accounts.active).toBeUndefined();
});

Then('the preview kernl guard profile is {string}', (world: PreviewWorld, profile: string) => {
  const { guard } = preview(world).kernl;
  expect(guard.config.profile).toBe(profile);
  expect(current(guard.profile$)).toBe(profile);
});

When('the preview kernl guard profile is set to {string}', (world: PreviewWorld, profile: 'strict' | 'balanced' | 'relaxed') => {
  preview(world).kernl.guard.setProfile(profile);
});

Then('the preview kernl guard describes its mitigations and can release window {string}', (world: PreviewWorld, windowId: string) => {
  const { guard } = preview(world).kernl;
  expect(guard.mitigations().length).toBeGreaterThan(0);
  expect(() => guard.release(windowId)).not.toThrow();
});

Then('every preview kernl bridge is routed by each of its schemes', (world: PreviewWorld) => {
  const { bridges } = preview(world).kernl;
  expect(bridges.list().length).toBeGreaterThan(0);
  for (const bridge of bridges.list()) {
    expect(bridge.schemes.length).toBeGreaterThan(0);
    for (const scheme of bridge.schemes) expect(bridges.forScheme(scheme)).toBe(bridge);
  }
});

When('the preview kernl logs in a read-only account', async (world: PreviewWorld) => {
  const scratch = preview(world);
  scratch.account = ReadonlyAccount.fromPubkey(READONLY_PUBKEY);
  await scratch.kernl.login(scratch.account);
});

When('the preview kernl logs in a key account named {string}', async (world: PreviewWorld, name: string) => {
  const scratch = preview(world);
  const account = PrivateKeyAccount.generateNew<{ name: string }>();
  account.metadata = { name };
  scratch.account = account;
  await scratch.kernl.login(account);
});

When('the preview kernl logs in the same account again', async (world: PreviewWorld) => {
  const scratch = preview(world);
  if (!scratch.account) throw new Error('log in first');
  await scratch.kernl.login(scratch.account);
});

Then('the preview kernl session is labelled with the abbreviated key', (world: PreviewWorld) => {
  expect(preview(world).kernl.session?.label).toBe(abbreviate(READONLY_PUBKEY));
});

Then('the preview kernl session is labelled {string}', (world: PreviewWorld, label: string) => {
  expect(preview(world).kernl.session?.label).toBe(label);
});

Then('the preview kernl session read-only is {string}', (world: PreviewWorld, readOnly: string) => {
  const { kernl, account } = preview(world);
  expect(kernl.session?.readOnly).toBe(readOnly === 'true');
  expect(current(kernl.session$)?.accountId).toBe(account?.id);
  expect(kernl.accounts.active).toBe(account);
});

Then('the preview kernl holds {int} account(s)', (world: PreviewWorld, count: number) => {
  expect(preview(world).kernl.accounts.accounts).toHaveLength(count);
});

When('the preview kernl logs out', async (world: PreviewWorld) => {
  await preview(world).kernl.logout();
});

When('the preview kernl decodes {string}', async (world: PreviewWorld, input: string) => {
  const scratch = preview(world);
  await capture(scratch, () => {
    scratch.pointer = scratch.kernl.decodePointer(input);
  });
});

Then('the preview kernl refused with {string}', (world: PreviewWorld, reason: string) => {
  expect(preview(world).error?.message).toBe(reason);
});

Then('the preview kernl pointer is an address for {string}', (world: PreviewWorld, identifier: string) => {
  const pointer = preview(world).pointer;
  expect(pointer).toMatchObject({ kind: 'address', identifier, eventKind: sample(identifier).manifest.kind, relays: [] });
});

Then('the preview kernl pointer is an event {string}', (world: PreviewWorld, id: string) => {
  expect(preview(world).pointer).toEqual({ kind: 'event', id, relays: [] });
});

When('the preview kernl resolves the decoded pointer', async (world: PreviewWorld) => {
  const scratch = preview(world);
  const pointer = scratch.pointer;
  if (!pointer) throw new Error('decode first');
  await capture(scratch, async () => {
    scratch.summary = await scratch.kernl.resolve(pointer);
  });
});

When('the preview kernl resolves the address {string}', async (world: PreviewWorld, identifier: string) => {
  const scratch = preview(world);
  await capture(scratch, async () => {
    scratch.summary = await scratch.kernl.resolve({ kind: 'address', pubkey: READONLY_PUBKEY, identifier, eventKind: 35129, relays: [] });
  });
});

Then('the preview kernl resolved the applet {string}', (world: PreviewWorld, title: string) => {
  const scratch = preview(world);
  expect(scratch.error).toBeUndefined();
  expect(scratch.summary?.title).toBe(title);
});

Given('the preview kernl user granted {string} to {string}', (world: PreviewWorld, domains: string, name: string) => {
  const { grants } = preview(world).kernl;
  for (const domain of list(domains)) grants.allowDomain(sample(name).identity, domain);
});

Given('the preview kernl user blocked {string}', (world: PreviewWorld, name: string) => {
  preview(world).kernl.grants.block(sample(name).identity);
});

When('the preview kernl plans {string}', async (world: PreviewWorld, name: string) => {
  const scratch = preview(world);
  await capture(scratch, async () => {
    scratch.plan = await scratch.kernl.plan(sample(name));
  });
});

Then('the preview kernl plan is for window {string}', (world: PreviewWorld, windowId: string) => {
  const plan = preview(world).plan;
  expect(plan?.windowId).toBe(windowId);
  expect(plan?.sandbox).toBe('allow-scripts');
  expect(plan?.srcdoc).toContain(plan?.summary.title);
});

Then('the preview kernl plan grants {string} beyond the baseline', (world: PreviewWorld, domains: string) => {
  const plan = preview(world).plan;
  expect(plan?.environment.capabilities.domains).toEqual([...BASELINE_DOMAINS, ...list(domains)]);
  expect(plan?.environment.services).toEqual([]);
});

Then('the preview kernl plan is missing {string}', (world: PreviewWorld, domains: string) => {
  expect(preview(world).plan?.missingRequired).toEqual(list(domains));
});

async function mountInto(world: PreviewWorld, name: string, frameName: string, detached: boolean): Promise<void> {
  const scratch = preview(world);
  const plan = await scratch.kernl.plan(sample(name));
  const frame = createPreviewFrame(detached);
  scratch.plan = plan;
  scratch.frames.set(frameName, frame);
  scratch.handles.set(frameName, scratch.kernl.mount(plan, frame));
}

When('the preview kernl mounts {string} in frame {string}', (world: PreviewWorld, name: string, frameName: string) => mountInto(world, name, frameName, false));

When('the preview kernl mounts {string} in a detached frame {string}', (world: PreviewWorld, name: string, frameName: string) => mountInto(world, name, frameName, true));

Then('the preview kernl frame {string} is sandboxed and holds the applet document', (world: PreviewWorld, name: string) => {
  const scratch = preview(world);
  const frame = frameOf(scratch, name);
  expect(frame.attributes.get('sandbox')).toBe('allow-scripts');
  expect(frame.srcdoc).toBe(scratch.plan?.srcdoc);
  const handle = handleOf(scratch, name);
  expect(handle.windowId).toBe(scratch.plan?.windowId);
  expect(handle.summary).toBe(scratch.plan?.summary);
});

Then('the preview kernl applet in frame {string} is {string}', (world: PreviewWorld, name: string, status: string) => {
  const handle = handleOf(preview(world), name);
  expect(handle.status).toBe(status);
});

Then('the preview kernl lists {int} applet(s)', (world: PreviewWorld, count: number) => {
  expect(preview(world).kernl.applets()).toHaveLength(count);
});

When('the preview kernl frame {string} posts {string}', (world: PreviewWorld, name: string, json: string) => {
  post(preview(world), name, JSON.parse(json));
});

When('a stranger posts {string} to the preview kernl', (world: PreviewWorld, json: string) => {
  preview(world).kernl.handleWindowMessage({ source: {} as Window, data: JSON.parse(json) } as MessageEvent);
});

Then('the preview kernl frame {string} is answered {string} with {string}', async (world: PreviewWorld, name: string, ok: string, text: string) => {
  const frame = frameOf(preview(world), name);
  await vi.waitFor(() => {
    const last = frame.posts.at(-1);
    expect(last).toMatchObject({ kernlPreview: 'result', ok: ok === 'yes' });
    expect(String(last?.text)).toContain(text);
  });
});

Then('the preview kernl frame {string} hears nothing', async (world: PreviewWorld, name: string) => {
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(frameOf(preview(world), name).posts).toEqual([]);
});

Then('the preview kernl user was asked {int} time(s)', (world: PreviewWorld, count: number) => {
  expect(preview(world).prompts).toHaveLength(count);
});

Then('the preview kernl host was notified {string} for frame {string}', (world: PreviewWorld, body: string, name: string) => {
  const scratch = preview(world);
  const handle = handleOf(scratch, name);
  expect(scratch.notices).toEqual([{ title: handle.summary.title, body, windowId: handle.windowId, tone: 'info' }]);
});

Then('the preview kernl host opened {int} link(s)', (world: PreviewWorld, count: number) => {
  expect(preview(world).links).toHaveLength(count);
});

Then('the preview kernl host opened {string}', (world: PreviewWorld, links: string) => {
  expect(preview(world).links).toEqual(list(links));
});

When('the preview kernl closes the applet in frame {string}', (world: PreviewWorld, name: string) => {
  handleOf(preview(world), name).close();
});

When('the preview kernl hides the applet in frame {string}', (world: PreviewWorld, name: string) => {
  handleOf(preview(world), name).setVisibility({ visible: false, focused: false });
});

Then('the preview kernl frame {string} is removed', (world: PreviewWorld, name: string) => {
  expect(frameOf(preview(world), name).removed).toBe(true);
});

Then('the preview kernl frame {string} is still attached', (world: PreviewWorld, name: string) => {
  expect(frameOf(preview(world), name).removed).toBe(false);
});

When('the preview kernl frame {string} floods the shell', (world: PreviewWorld, name: string) => {
  const scratch = preview(world);
  const handle = handleOf(scratch, name);
  for (let sent = 0; sent < 5000 && handle.status !== 'revoked'; sent += 1) post(scratch, name, { kernlPreview: 'hello' });
});

When('the preview kernl frame {string} floods the shell and keeps sending while it is stopped', (world: PreviewWorld, name: string) => {
  const scratch = preview(world);
  const handle = handleOf(scratch, name);
  const subscription = handle.status$.subscribe((status) => {
    if (status === 'revoked') post(scratch, name, { kernlPreview: 'hello' });
  });
  for (let sent = 0; sent < 5000 && handle.status !== 'revoked'; sent += 1) post(scratch, name, { kernlPreview: 'hello' });
  subscription.unsubscribe();
});

When('the preview kernl frame {string} nearly floods the shell and floods it while closing', (world: PreviewWorld, name: string) => {
  const scratch = preview(world);
  const handle = handleOf(scratch, name);
  const threshold = scratch.kernl.guard.config.limits.quarantineThreshold;
  for (let sent = 1; sent < threshold; sent += 1) post(scratch, name, { kernlPreview: 'hello' });
  const subscription = handle.status$.subscribe((status) => {
    if (status === 'closed') post(scratch, name, { kernlPreview: 'hello' });
  });
  handle.close();
  subscription.unsubscribe();
});

Then('the preview kernl host heard {int} revocation(s)', (world: PreviewWorld, count: number) => {
  expect(preview(world).revoked).toHaveLength(count);
});

Then('the preview kernl host heard frame {string} revoked for {string}', (world: PreviewWorld, name: string, reason: string) => {
  const scratch = preview(world);
  expect(scratch.revoked).toContainEqual({ windowId: handleOf(scratch, name).windowId, reason });
});

When('the preview kernl is destroyed', (world: PreviewWorld) => {
  preview(world).kernl.destroy();
});

Then('the preview kernl store lists {string}', async (world: PreviewWorld, titles: string) => {
  expect((await preview(world).kernl.catalog.load()).map((entry) => entry.title)).toEqual(list(titles));
});

When('the preview kernl installs {string} without running it', (world: PreviewWorld, name: string) => {
  preview(world).kernl.install(sample(name));
});

Given('the preview kernl has {string} installed', (world: PreviewWorld, name: string) => {
  preview(world).kernl.install(sample(name));
});

Then('the preview kernl has installed {string}', (world: PreviewWorld, titles: string) => {
  expect(preview(world).kernl.intents.installed().map((applet) => applet.title)).toEqual(list(titles));
});

Given('the preview kernl user will pick {string} from the store', (world: PreviewWorld, name: string) => {
  preview(world).pickFromStore = name;
});

Given('the preview kernl desktop opens a window that is gone', (world: PreviewWorld) => {
  preview(world).openGhost = true;
});

Given('the preview kernl runs {string} in frame {string}', async (world: PreviewWorld, name: string, frameName: string) => {
  await mountInto(world, name, frameName, false);
  post(preview(world), frameName, { kernlPreview: 'hello' });
});

Then('the preview kernl user was offered no installed applet for {string} from {string}', (world: PreviewWorld, request: string, source: string) => {
  const [archetype, action] = request.split('/');
  expect(preview(world).asked).toEqual([{ archetype, action, convention: `napplet:${request}`, source, options: [] }]);
});

Then('the preview kernl user was not asked to choose an applet', (world: PreviewWorld) => {
  expect(preview(world).asked).toEqual([]);
});

Then('the preview kernl desktop opened {string}', (world: PreviewWorld, address: string) => {
  expect(preview(world).opened).toEqual([address]);
});

Then('the preview kernl desktop opened nothing and brought the applet in frame {string} forward', (world: PreviewWorld, frameName: string) => {
  expect(preview(world).opened).toEqual([]);
  expect(preview(world).focused).toEqual([handleOf(preview(world), frameName).windowId]);
});

Then('the preview kernl frame {string} was handed {string}', async (world: PreviewWorld, frameName: string, text: string) => {
  await vi.waitFor(() => expect(frameOf(preview(world), frameName).posts).toContainEqual({ kernlPreview: 'delivery', text }));
});

Then('the preview kernl host was warned {string} because {string}', async (world: PreviewWorld, title: string, body: string) => {
  await vi.waitFor(() => expect(preview(world).notices).toContainEqual({ title, body, tone: 'warning' }));
});

Then('the preview kernl store streams {string}', async (world: PreviewWorld, titles: string) => {
  const streamed = await firstValueFrom(preview(world).kernl.catalog.stream());
  expect(streamed.map((entry) => entry.title)).toEqual(list(titles));
});

Then('the preview kernl names the correspondent {string}, the publisher {string} and its own account {string}', async (world: PreviewWorld, correspondent: string, publisher: string, owner: string) => {
  const { profiles } = preview(world).kernl;
  expect(profiles.card(PREVIEW_CORRESPONDENT).name).toBe(correspondent);
  expect((await firstValueFrom(profiles.card$(PREVIEW_PUBLISHER))).name).toBe(publisher);
  expect(profiles.card(PREVIEW_OWNER)).toMatchObject({ name: owner, found: true });
  expect(await profiles.settled(PREVIEW_CORRESPONDENT)).toMatchObject({ name: correspondent, found: true });
});

Then('the preview kernl names key {string} by its short form', (world: PreviewWorld, key: string) => {
  expect(preview(world).kernl.profiles.card(key)).toEqual({ pubkey: key, name: 'ABCDEF01…6789', found: false });
});

Then('the preview kernl mailboxes are missing, suggesting {int} inboxes and {int} outboxes', (world: PreviewWorld, inboxes: number, outboxes: number) => {
  const state = preview(world).kernl.mailboxes.state();
  expect(state.status).toBe('missing');
  if (state.status !== 'missing') return;
  expect(state.suggested.inboxes).toHaveLength(inboxes);
  expect(state.suggested.outboxes).toHaveLength(outboxes);
});

Then('the preview kernl directory suggests {int} lookup servers and completes nothing for {string}', (world: PreviewWorld, count: number, text: string) => {
  const { directory } = preview(world).kernl;
  directory.start();
  expect(directory.suggest({ purpose: 'lookup' })).toHaveLength(count);
  expect(directory.search(text)).toEqual([]);
  directory.stop();
});

When('the preview kernl saves inbox {string} and outbox {string}', async (world: PreviewWorld, inboxes: string, outboxes: string) => {
  (world as PreviewWorld & { saved?: unknown }).saved = await preview(world).kernl.mailboxes.save({ inboxes: list(inboxes), outboxes: list(outboxes) });
});

Then('the preview kernl save was accepted by {int} servers', (world: PreviewWorld, count: number) => {
  expect((world as PreviewWorld & { saved?: { accepted: string[]; ok: boolean } }).saved).toMatchObject({ ok: count > 0, refused: [] });
  expect((world as PreviewWorld & { saved?: { accepted: string[] } }).saved?.accepted).toHaveLength(count);
});

Then('the preview kernl mailboxes are found with inbox {string} and outbox {string}', (world: PreviewWorld, inboxes: string, outboxes: string) => {
  expect(preview(world).kernl.mailboxes.state()).toMatchObject({ status: 'found', mailboxes: { inboxes: list(inboxes), outboxes: list(outboxes) } });
});

When('the preview kernl sets the {string} tier to {string}', (world: PreviewWorld, tier: 'outbox', urls: string) => {
  preview(world).kernl.relays.set(tier, list(urls));
});

Then('the preview kernl {string} tier is {string}', (world: PreviewWorld, tier: 'outbox', urls: string) => {
  expect(preview(world).kernl.relays.get()[tier]).toEqual(list(urls));
});

Then('the preview kernl refuses to set the {string} tier to {string}', (world: PreviewWorld, tier: 'outbox', urls: string) => {
  expect(() => preview(world).kernl.relays.set(tier, list(urls))).toThrow('invalid:url');
});
