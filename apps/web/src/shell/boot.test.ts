import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KernlHost } from './contract';
import { MESSAGES_APPLET } from './messages-applet';

const host: KernlHost = {
  storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  presentConsent: () => undefined,
  notify: () => undefined,
  openLink: () => undefined,
  getVisibility: () => ({ visible: true, focused: true }),
  onRevoked: () => undefined,
};
// The module registry is reset for every boot, so the applet is matched by what it is, not by reference.
const shipped = [expect.objectContaining({ id: 'messages', sha256: MESSAGES_APPLET.sha256 })];
const theme = { colors: { background: '#fcfaf4', text: '#15171b', primary: '#9a5b00' } };
// The live shell names its modules through kernl's preset, because only the theme module may publish a colour change.
const modules = vi.fn((options: { theme?: typeof theme; eventCache?: unknown } = {}) => [{ id: 'theme', options }]);
const signers = { NostrConnectSigner: { pool: undefined as unknown } };

async function bootWith(core: Record<string, unknown> | (() => never)): Promise<typeof import('./boot')> {
  vi.resetModules();
  modules.mockClear();
  vi.doMock('applesauce-signers', () => signers);
  vi.doMock('@kernlize/core', () => (typeof core === 'function' ? core() : core));
  vi.doMock('@kernlize/preset', () => ({ kernlPreset: modules }));
  return import('./boot');
}

// Node 25 and later define a global sessionStorage, which the live shell hands to Outbox replay; the tests
// that do not name it start without one, so they hold on every Node the project runs.
beforeEach(() => {
  vi.stubGlobal('sessionStorage', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('applesauce-signers');
  vi.doUnmock('@kernlize/core');
  vi.doUnmock('@kernlize/preset');
  signers.NostrConnectSigner.pool = undefined;
});

describe('boot', () => {
  it.each([{}, { createKernl: 'not a function' }])('says why, and starts nothing in its place, when the build has no live shell (%o)', async (core) => {
    const { boot } = await bootWith(core);
    await expect(boot(host, new URLSearchParams())).rejects.toThrow('This build has no live shell.');
  });

  it('composes the live shell and lends its pool to remote signers', async () => {
    const live = { pool: { kind: 'pool' } };
    const createKernl = vi.fn(() => live);
    const { boot } = await bootWith({ createKernl });
    const booted = await boot(host, new URLSearchParams('preview=0'));
    const named = modules.mock.results[0]?.value;
    expect(createKernl).toHaveBeenCalledWith({ host, builtins: shipped, modules: named });
    expect(booted).toEqual({ kernl: live, mode: 'live', downloads: booted.downloads });
    expect(signers.NostrConnectSigner.pool).toBe(live.pool);
  });

  it('ships the messages applet and tells applets the page colours', async () => {
    const createKernl = vi.fn(() => ({ pool: {} }));
    const { boot } = await bootWith({ createKernl });
    const live = await boot(host, new URLSearchParams(), theme);
    expect(modules).toHaveBeenCalledWith({ theme, eventCache: expect.any(Function), shortcuts: { reserved: ['Alt+/'] }, torrent: live.downloads.torrent });
    expect(createKernl).toHaveBeenCalledWith({ host, builtins: shipped, modules: modules.mock.results[0]?.value });
  });

  it('names no theme to the modules when the page has none, and still hands them the event cache', async () => {
    const { boot } = await bootWith({ createKernl: vi.fn(() => ({ pool: {} })) });
    await boot(host, new URLSearchParams());
    // Named modules are the only readers of the opener: left on `createKernl` it is ignored and the cache is memory only.
    expect(modules).toHaveBeenCalledWith({ eventCache: expect.any(Function), shortcuts: { reserved: ['Alt+/'] }, torrent: expect.anything() });
  });

  it('leaves the settings form to the host\'s settings renderer, which the settings module draws through', async () => {
    const { boot } = await bootWith({ createKernl: vi.fn(() => ({ pool: {} })) });
    await boot(host, new URLSearchParams());
    expect(modules.mock.calls.at(-1)?.[0]).not.toHaveProperty('presentSettings');
  });

  it('hands links to the device in a live shell whose browser cannot reach peers', async () => {
    const opened: string[] = [];
    const { boot } = await bootWith({ createKernl: vi.fn(() => ({ pool: {} })) });
    const booted = await boot({ ...host, openLink: (uri) => void opened.push(uri) }, new URLSearchParams());
    expect(booted.downloads.inKernl).toBe(false);
    expect(booted.downloads.mode()).toBe('device');
    await booted.downloads.torrent.add('ab'.repeat(20), [], { requester: 'shell' });
    expect(opened).toEqual([`magnet:?xt=urn:btih:${'ab'.repeat(20)}`]);
  });

  it.each([
    [new Error('relay pool exploded'), 'relay pool exploded'],
    ['plain words', 'plain words'],
  ])('rejects with what went wrong when composing throws (%s), and starts nothing in its place', async (thrown, words) => {
    const createKernl = (): never => {
      throw thrown;
    };
    const { boot } = await bootWith({ createKernl });
    await expect(boot(host, new URLSearchParams())).rejects.toSatisfy((reason) => (reason instanceof Error ? reason.message : reason) === words);
  });

  it('rejects when the core cannot be loaded, and starts nothing in its place', async () => {
    const { boot } = await bootWith(() => {
      throw new Error('chunk missing');
    });
    // vitest wraps a failing module factory in its own words; what matters is that boot rejects rather than inventing a shell.
    await expect(boot(host, new URLSearchParams())).rejects.toBeInstanceOf(Error);
  });
});

it('uses browser session storage only for live Outbox replay', async () => {
  const createKernl = vi.fn(() => ({ pool: {} }));
  const { boot } = await bootWith({ createKernl });
  const session = { getItem: () => null, setItem() {}, removeItem() {} };
  vi.stubGlobal('sessionStorage', session);
  await boot(host, new URLSearchParams());
  expect(createKernl).toHaveBeenCalledWith(expect.objectContaining({ host: { ...host, outboxCacheStorage: session } }));
});

it('boots live when browser session storage is forbidden', async () => {
  const createKernl = vi.fn(() => ({ pool: {} }));
  const { boot } = await bootWith({ createKernl });
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new DOMException('forbidden', 'SecurityError'); } });
  try {
    await expect(boot(host, new URLSearchParams())).resolves.toMatchObject({ mode: 'live' });
    expect(createKernl).toHaveBeenCalledWith(expect.objectContaining({ host }));
  } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
