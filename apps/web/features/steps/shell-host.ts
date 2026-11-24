import { expect, vi } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import type { GuardProfile } from '@kernlize/guard';
import { ASK_KINDS, type Ask, type AskKind, type AskRenderer, type FirewallSummary, type SettingsPrompt } from '@kernlize/core';
import { createAskQueue, type AskQueue } from '@kernlize/ui-model';
import type { ReplyPrompt } from '@kernlize/messaging';
import type { AppletStopLimit, ConsentPrompt, FirewallPrompt, KernlHost, StorageLike } from '../../src/shell/contract.ts';
import { createHost, pickStorage, PREVIEW_STORAGE_PREFIX, scopedStorage, type AppletOpener } from '../../src/shell/host.ts';
import { SHELL_CHORDS, shellShortcut, type ShortcutRunner } from '../../src/shell/shortcuts.ts';
import { describeStop, type StopReport } from '../../src/shell/stop-words.ts';

type HostDeps = Parameters<typeof createHost>[0];

/** The fakes implement only what the host calls; the stores' other members are never read. */
function fake<T>(value: unknown): T {
  return value as T;
}

interface FakeWindow {
  readonly title: string;
  revokedWith?: StopReport;
}

interface HostScratch {
  readonly host: KernlHost;
  readonly queued: Pick<ConsentPrompt, 'summary'>[];
  readonly firewallQueued: Pick<FirewallPrompt, 'summary' | 'signal'>[];
  readonly settings: unknown[];
  readonly notices: unknown[];
  readonly windows: Map<string, FakeWindow>;
  readonly opened: unknown[][];
  readonly confirmations: string[];
  confirm: boolean;
  readonly asked: unknown[];
  readonly answers: Map<string, unknown>;
  readonly focused: string[];
  readonly opener: AppletOpener;
  readonly shortcuts: ShortcutRunner;
  readonly ran: string[];
}

interface HostWorld {
  shellHost?: HostScratch;
  shellStorage?: { picked: StorageLike; calls: string[]; native?: StorageLike };
}

function hostOf(world: HostWorld): HostScratch {
  if (!world.shellHost) throw new Error('create the shell host first');
  return world.shellHost;
}

function storageOf(world: HostWorld): NonNullable<HostWorld['shellStorage']> {
  if (!world.shellStorage) throw new Error('pick the shell host storage first');
  return world.shellStorage;
}

After(async (world: HostWorld) => {
  if (world.shellHost || world.shellStorage) vi.unstubAllGlobals();
});

Given('the shell host storage is the browser storage', (world: HostWorld) => {
  const calls: string[] = [];
  const map = new Map<string, string>();
  const native: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      calls.push(`set ${key}`);
      map.set(key, value);
    },
    removeItem: (key) => {
      calls.push(`remove ${key}`);
      map.delete(key);
    },
  };
  vi.stubGlobal('localStorage', native);
  world.shellStorage = { picked: pickStorage(), calls, native };
});

Given('the shell host storage is refused by the browser', (world: HostWorld) => {
  vi.stubGlobal('localStorage', {
    setItem: () => {
      throw new Error('SecurityError');
    },
  });
  world.shellStorage = { picked: pickStorage(), calls: [] };
});

Then('the shell host uses the browser storage after probing it', (world: HostWorld) => {
  const storage = storageOf(world);
  expect(storage.picked).toBe(storage.native);
  expect(storage.calls).toEqual(['set __kernl_probe__', 'remove __kernl_probe__']);
  expect(storage.picked.getItem('__kernl_probe__')).toBeNull();
});

Then('the shell host keeps {string} as {string} for the page only', (world: HostWorld, key: string, value: string) => {
  const { picked } = storageOf(world);
  expect(picked).not.toBe(globalThis.localStorage);
  expect(picked.getItem(key)).toBeNull();
  picked.setItem(key, value);
  expect(picked.getItem(key)).toBe(value);
  picked.removeItem(key);
  expect(picked.getItem(key)).toBeNull();
});

Given('the shell host with window {string} titled {string}', (world: HostWorld, windowId: string, title: string) => {
  const queued: Pick<ConsentPrompt, 'summary'>[] = [];
  const settings: unknown[] = [];
  const notices: unknown[] = [];
  const windows = new Map<string, FakeWindow>([[windowId, { title }]]);
  const opened: unknown[][] = [];
  const firewallQueued: Pick<FirewallPrompt, 'summary' | 'signal'>[] = [];
  const confirmations: string[] = [];
  const asked: unknown[] = [];
  const focused: string[] = [];
  const opener: AppletOpener = {};
  const shortcuts: ShortcutRunner = {};
  // Real queues behind the dialogs; what waits in them is mirrored where the scenarios read it.
  const mirror = <T>(target: T[], queue: AskQueue<AskKind>, view: (ask: Ask) => T): void => void queue.waiting$.subscribe((asks) => target.splice(0, target.length, ...asks.map(view)));
  const answering = (queue: AskQueue<AskKind>, answer: unknown): AskQueue<AskKind> => {
    queue.current$.subscribe((ask) => {
      if (!ask) return;
      asked.push(ask.facts);
      queue.answer(answer as never);
    });
    return queue;
  };
  const models = { consent: createAskQueue(), firewall: createAskQueue(), settings: createAskQueue() };
  mirror(queued, models.consent, (ask) => ({ summary: ask.defaultText as ConsentPrompt['summary'] }));
  mirror(firewallQueued, models.firewall, (ask) => ({ summary: ask.facts as FirewallPrompt['summary'], signal: ask.signal as FirewallPrompt['signal'] }));
  mirror(settings, models.settings, (ask) => ask.facts);
  const deps = fake<HostDeps>({
    shortcuts,
    handlers: { model: answering(createAskQueue(), { id: 'picked', remember: true }) },
    replies: { model: answering(createAskQueue(), { use: 'theirs', remember: 'conversation' }) },
    opener,
    storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    consent: { model: models.consent },
    firewall: { model: models.firewall },
    settings: { model: models.settings },
    notices: { push: (notice: unknown) => notices.push(notice) },
    windows: {
      get: (id: string) => {
        const window = windows.get(id);
        return window && { plan: { summary: { title: window.title } } };
      },
      visibilityOf: (id: string) => ({ visible: windows.has(id), focused: false }),
      focus: (id: string) => void focused.push(id),
      markRevoked: (id: string, report: StopReport) => {
        const window = windows.get(id);
        if (window) window.revokedWith = report;
      },
    },
  });
  const scratch: HostScratch = { host: createHost(deps), queued, firewallQueued, settings, notices, windows, opened, confirmations, confirm: false, asked, answers: new Map(), focused, opener, shortcuts, ran: [] };
  vi.stubGlobal('window', {
    confirm: (message: string) => {
      confirmations.push(message);
      return scratch.confirm;
    },
    open: (...args: unknown[]) => void opened.push(args),
  });
  world.shellHost = scratch;
});

/** The host's renderer for a kind, which the shell host always registers. */
function drawOf<K extends AskKind>(host: KernlHost, kind: K): AskRenderer<K> {
  return host.asks?.[kind] as AskRenderer<K>;
}

Then('the shell host forwards consent, notices and visibility for window {string}', (world: HostWorld, windowId: string) => {
  const scratch = hostOf(world);
  const summary = fake<ConsentPrompt['summary']>({ title: 'Delete a note' });
  void drawOf(scratch.host, 'sign.replace')(fake({ kind: 'sign.replace', defaultText: summary }));
  scratch.host.notify({ title: 'Saved', tone: 'info' });
  expect(scratch.queued.map((queued) => queued.summary)).toEqual([summary]);
  expect(scratch.notices).toEqual([{ title: 'Saved', tone: 'info' }]);
  expect(scratch.host.getVisibility(windowId)).toEqual({ visible: true, focused: false });
  expect(scratch.host.storage.getItem('anything')).toBeNull();
});

Then('the shell host asks the chooser, opens applets through the desktop once it can, and brings windows forward', async (world: HostWorld) => {
  const scratch = hostOf(world);
  const prompt = { archetype: 'profile', action: 'open', convention: 'napplet:profile/open', source: 'Notes', options: [] };
  expect(await drawOf(scratch.host, 'intent.choose-handler')(fake({ kind: 'intent.choose-handler', facts: prompt }))).toEqual({ id: 'picked', remember: true });
  expect(scratch.asked).toEqual([prompt]);
  expect(await scratch.host.openApplet?.('naddr1x')).toBeUndefined();
  scratch.opener.open = async (address) => `window-for-${address}`;
  expect(await scratch.host.openApplet?.('naddr1x')).toBe('window-for-naddr1x');
  scratch.host.focusApplet?.('w1');
  expect(scratch.focused).toEqual(['w1']);
});

When('the shell host is asked to open {string} and the user says {string}', (world: HostWorld, url: string, answer: string) => {
  const scratch = hostOf(world);
  scratch.confirm = answer === 'yes';
  scratch.host.openLink(url);
});

When('the shell host is asked to open {string}, which the firewall already let through', (world: HostWorld, url: string) => {
  hostOf(world).host.openLink(url, { approved: true });
});

Then('the shell host did not ask again', (world: HostWorld) => {
  expect(hostOf(world).confirmations).toEqual([]);
});

Then('the shell host puts a firewall question in the firewall queue', (world: HostWorld) => {
  const scratch = hostOf(world);
  const facts = fake<FirewallSummary>({ kind: 'link' });
  const signal = new AbortController().signal;
  void drawOf(scratch.host, 'firewall.approve')(fake({ kind: 'firewall.approve', facts, signal }));
  expect(scratch.firewallQueued.map((queued) => ({ summary: queued.summary, signal: queued.signal }))).toEqual([{ summary: facts, signal }]);
});

Then('the shell host asked before opening {string}', (world: HostWorld, url: string) => {
  expect(hostOf(world).confirmations.at(-1)).toBe(`Leave kernl and open this link?\n\n${url}`);
});

Then('the shell host opened {string} in a new, unlinked tab', (world: HostWorld, url: string) => {
  expect(hostOf(world).opened).toEqual([[url, '_blank', 'noopener,noreferrer']]);
});

Then('the shell host opened nothing', (world: HostWorld) => {
  expect(hostOf(world).opened).toEqual([]);
});

When('the shell host hears window {string} was revoked for {string}', (world: HostWorld, windowId: string, reason: string) => {
  hostOf(world).host.onRevoked(windowId, reason);
});

When('the shell host hears window {string} was revoked for {string} with the detail {string}', (world: HostWorld, windowId: string, reason: string, detail: string) => {
  hostOf(world).host.onRevoked(windowId, reason, { detail });
});

When('the shell host hears window {string} was quarantined for {string} at {int} per {int} ms under {string}', (world: HostWorld, windowId: string, cause: AppletStopLimit['cause'], count: number, span: number, profile: GuardProfile) => {
  hostOf(world).host.onRevoked(windowId, 'quarantine', { limit: { cause, count, profile, ...(span > 0 ? { windowMs: span } : {}) } });
});

const reportOf = (world: HostWorld, windowId: string): StopReport | undefined => hostOf(world).windows.get(windowId)?.revokedWith;

Then('window {string} stopped by {string}, with {string} next and code {string}', (world: HostWorld, windowId: string, by: string, next: string, code: string) => {
  // A window the host does not know about is not marked; the notice still goes out.
  const report = reportOf(world, windowId) ?? describeStop(code, undefined, 0);
  expect({ by: report.by ?? '', next: report.next, code: report.code }).toEqual({ by, next, code });
});

Then('window {string} stopped with the detail {string} and no limit', (world: HostWorld, windowId: string, detail: string) => {
  expect(reportOf(world, windowId)).toMatchObject({ detail, code: 'window-message' });
  expect(reportOf(world, windowId)?.limit).toBeUndefined();
});

Then('window {string} stopped at the limit {string}', (world: HostWorld, windowId: string, limit: string) => {
  expect(reportOf(world, windowId)?.limit).toBe(limit);
});

Then('the shell host warns {string} because {string} for window {string}', (world: HostWorld, title: string, words: string, windowId: string) => {
  expect(hostOf(world).notices.at(-1)).toEqual({ title, body: words, tone: 'warning', windowId });
});

Then('the shell host puts the reply question to the reply dialog', async (world: HostWorld) => {
  const scratch = hostOf(world);
  const provider = { id: 'private', name: 'Private messages' };
  const prompt = fake<ReplyPrompt>({ peer: { pubkey: 'ab'.repeat(32) }, theirs: provider, mine: provider });
  expect(await drawOf(scratch.host, 'messaging.choose-reply')(fake({ kind: 'messaging.choose-reply', facts: prompt }))).toEqual({ use: 'theirs', remember: 'conversation' });
  expect(scratch.asked).toEqual([prompt]);
});

Then('the shell host shows an applet\'s settings in the settings form', (world: HostWorld) => {
  const scratch = hostOf(world);
  const prompt = fake<SettingsPrompt>({ title: 'Notes', context: { schema: {}, values: {}, commit: (values: unknown) => values } });
  void drawOf(scratch.host, 'settings.present')(fake({ kind: 'settings.present', facts: prompt }));
  expect(scratch.settings).toEqual([prompt]);
});

Then('the shell host draws every kind of question the kernel asks, through no prompt callback', (world: HostWorld) => {
  const { host } = hostOf(world);
  expect(Object.keys(host.asks ?? {}).sort()).toEqual([...ASK_KINDS].sort());
  for (const callback of ['presentConsent', 'presentApproval', 'chooseHandler', 'chooseReply', 'presentSettings']) expect(callback in host).toBe(false);
});

Then('an upload, a download and a direct session wait in the consent queue with kernl\'s words', (world: HostWorld) => {
  const scratch = hostOf(world);
  const kinds = ['upload.file', 'download.add', 'connection.direct'] as const;
  for (const kind of kinds) void drawOf(scratch.host, kind)(fake({ kind, defaultText: fake<ConsentPrompt['summary']>({ title: kind }) }));
  expect(scratch.queued.map((queued) => queued.summary.title)).toEqual([...kinds]);
});

interface ScopedWorld extends HostWorld {
  scoped?: { held: Map<string, string>; preview: StorageLike };
}

Given('a store that holds {string} as {string}', (world: ScopedWorld, key: string, value: string) => {
  const held = new Map([[key, value]]);
  const store: StorageLike = { getItem: (name) => held.get(name) ?? null, setItem: (name, next) => void held.set(name, next), removeItem: (name) => void held.delete(name) };
  world.scoped = { held, preview: scopedStorage(store, PREVIEW_STORAGE_PREFIX) };
});

When('the preview writes {string} as {string} through its own view of that store', (world: ScopedWorld, key: string, value: string) => {
  world.scoped?.preview.setItem(key, value);
});

Then('the store holds {string} as {string} and {string} as {string}', (world: ScopedWorld, first: string, firstValue: string, second: string, secondValue: string) => {
  expect(Object.fromEntries(world.scoped?.held ?? [])).toEqual({ [first]: firstValue, [second]: secondValue });
});

Then('the preview reads {string} as {string}, and nothing once it removes it', (world: ScopedWorld, key: string, value: string) => {
  expect(world.scoped?.preview.getItem(key)).toBe(value);
  world.scoped?.preview.removeItem(key);
  expect(world.scoped?.preview.getItem(key)).toBeNull();
});

const pressed = (key: string, code: string, alt: string) => ({ key, code, altKey: alt === 'held', ctrlKey: false, shiftKey: false, metaKey: false });

When('the shell is on screen', (world: HostWorld) => {
  const scratch = hostOf(world);
  scratch.shortcuts.run = (key) => void scratch.ran.push(shellShortcut(key) ?? 'none');
});

When('the shell host is handed the key {string} at {string} with Alt {string}', (world: HostWorld, key: string, code: string, alt: string) => {
  hostOf(world).host.onShortcut?.(pressed(key, code, alt));
});

Then('the shell ran the shortcuts {string}', (world: HostWorld, expected: string) => {
  expect(hostOf(world).ran.filter((shortcut) => shortcut !== 'none').join(',')).toBe(expected);
});

Then("the key {string} at {string} with Alt {string} is the shell's {string} shortcut", (_world: HostWorld, key: string, code: string, alt: string, shortcut: string) => {
  expect(shellShortcut(pressed(key, code, alt)) ?? 'none').toBe(shortcut);
});

Then('an applet cannot bind {string}', (_world: HostWorld, chord: string) => {
  expect(SHELL_CHORDS).toContain(chord);
});

When('window {string} asks the shell host to sign a change, and so does window {string}', (world: HostWorld, first: string, second: string) => {
  const scratch = hostOf(world);
  for (const windowId of [first, second]) {
    void drawOf(scratch.host, 'sign.replace')(fake({ kind: 'sign.replace', windowId, defaultText: fake<ConsentPrompt['summary']>({ title: windowId }) })).then((answer) => scratch.answers.set(windowId, answer));
  }
});

Then("the consent queue holds only window {string}'s question", (world: HostWorld, windowId: string) => {
  expect(hostOf(world).queued.map((queued) => queued.summary.title)).toEqual([windowId]);
});

Then("window {string}'s question was answered no", async (world: HostWorld, windowId: string) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(hostOf(world).answers.get(windowId)).toBe(false);
});
