import { expect, vi } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import type { ConsentPrompt, KernlHost, StorageLike } from '../../src/shell/contract.ts';
import { createHost, pickStorage, type AppletOpener } from '../../src/shell/host.ts';

type HostDeps = Parameters<typeof createHost>[0];

/** The fakes implement only what the host calls; the stores' other members are never read. */
function fake<T>(value: unknown): T {
  return value as T;
}

interface FakeWindow {
  readonly title: string;
  revokedWith?: string;
}

interface HostScratch {
  readonly host: KernlHost;
  readonly queued: ConsentPrompt[];
  readonly notices: unknown[];
  readonly windows: Map<string, FakeWindow>;
  readonly opened: unknown[][];
  readonly confirmations: string[];
  confirm: boolean;
  readonly asked: unknown[];
  readonly focused: string[];
  readonly opener: AppletOpener;
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
  const queued: ConsentPrompt[] = [];
  const notices: unknown[] = [];
  const windows = new Map<string, FakeWindow>([[windowId, { title }]]);
  const opened: unknown[][] = [];
  const confirmations: string[] = [];
  const asked: unknown[] = [];
  const focused: string[] = [];
  const opener: AppletOpener = {};
  const deps = fake<HostDeps>({
    handlers: { ask: async (prompt: unknown) => (asked.push(prompt), { id: 'picked', remember: true }) },
    opener,
    storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
    consent: { enqueue: (prompt: ConsentPrompt) => void queued.push(prompt) },
    notices: { push: (notice: unknown) => notices.push(notice) },
    windows: {
      get: (id: string) => {
        const window = windows.get(id);
        return window && { plan: { summary: { title: window.title } } };
      },
      visibilityOf: (id: string) => ({ visible: windows.has(id), focused: false }),
      focus: (id: string) => void focused.push(id),
      markRevoked: (id: string, reason: string) => {
        const window = windows.get(id);
        if (window) window.revokedWith = reason;
      },
    },
  });
  const scratch: HostScratch = { host: createHost(deps), queued, notices, windows, opened, confirmations, confirm: false, asked, focused, opener };
  vi.stubGlobal('window', {
    confirm: (message: string) => {
      confirmations.push(message);
      return scratch.confirm;
    },
    open: (...args: unknown[]) => void opened.push(args),
  });
  world.shellHost = scratch;
});

Then('the shell host forwards consent, notices and visibility for window {string}', (world: HostWorld, windowId: string) => {
  const scratch = hostOf(world);
  const prompt = fake<ConsentPrompt>({ summary: { title: 'Delete a note' }, resolve: () => undefined });
  scratch.host.presentConsent(prompt);
  scratch.host.notify({ title: 'Saved', tone: 'info' });
  expect(scratch.queued).toEqual([prompt]);
  expect(scratch.notices).toEqual([{ title: 'Saved', tone: 'info' }]);
  expect(scratch.host.getVisibility(windowId)).toEqual({ visible: true, focused: false });
  expect(scratch.host.storage.getItem('anything')).toBeNull();
});

Then('the shell host asks the chooser, opens applets through the desktop once it can, and brings windows forward', async (world: HostWorld) => {
  const scratch = hostOf(world);
  const prompt = { archetype: 'profile', action: 'open', convention: 'napplet:profile/open', source: 'Notes', options: [] };
  expect(await scratch.host.chooseHandler?.(prompt)).toEqual({ id: 'picked', remember: true });
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

Then('the shell host marks window {string} stopped because {string}', (world: HostWorld, windowId: string, words: string) => {
  expect(hostOf(world).windows.get(windowId)?.revokedWith).toBe(words);
});

Then('the shell host warns {string} because {string} for window {string}', (world: HostWorld, title: string, words: string, windowId: string) => {
  expect(hostOf(world).notices.at(-1)).toEqual({ title, body: words, tone: 'warning', windowId });
});
