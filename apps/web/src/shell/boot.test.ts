import { afterEach, describe, expect, it, vi } from 'vitest';
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
const previewKernl = { kind: 'preview kernl' };
const createPreviewKernl = vi.fn(() => previewKernl);
// The module registry is reset for every boot, so the applet is matched by what it is, not by reference.
const shipped = [expect.objectContaining({ id: 'messages', sha256: MESSAGES_APPLET.sha256 })];
const theme = { colors: { background: '#fcfaf4', text: '#15171b', primary: '#9a5b00' } };
// The live shell names its modules through kernl's preset, because only the theme module may publish a colour change.
const modules = vi.fn((options: { theme?: typeof theme; eventCache?: unknown } = {}) => [{ id: 'theme', options }]);
const signers = { NostrConnectSigner: { pool: undefined as unknown } };

async function bootWith(core: Record<string, unknown> | (() => never)): Promise<typeof import('./boot')> {
  vi.resetModules();
  createPreviewKernl.mockClear();
  modules.mockClear();
  vi.doMock('./preview-kernl', () => ({ createPreviewKernl }));
  vi.doMock('applesauce-signers', () => signers);
  vi.doMock('@kernlize/core', () => (typeof core === 'function' ? core() : core));
  vi.doMock('@kernlize/preset', () => ({ kernlPreset: modules }));
  return import('./boot');
}

afterEach(() => {
  vi.doUnmock('./preview-kernl');
  vi.doUnmock('applesauce-signers');
  vi.doUnmock('@kernlize/core');
  vi.doUnmock('@kernlize/preset');
  signers.NostrConnectSigner.pool = undefined;
});

describe('boot', () => {
  it('starts the preview outright when the address asks for it', async () => {
    const { boot } = await bootWith({});
    const booted = await boot(host, new URLSearchParams('preview=1'));
    expect(booted.kernl).toBe(previewKernl);
    expect(booted.mode).toBe('preview');
    expect('fallbackReason' in booted).toBe(false);
  });

  it.each([{}, { createKernl: 'not a function' }])('falls back to the preview when the build has no live shell (%o)', async (core) => {
    const { boot } = await bootWith(core);
    const booted = await boot(host, new URLSearchParams());
    expect(booted).toMatchObject({ kernl: previewKernl, mode: 'preview', fallbackReason: 'The live shell is not part of this build yet.' });
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

  it('ships the messages applet and tells applets the page colours, live and in the preview', async () => {
    const createKernl = vi.fn(() => ({ pool: {} }));
    const { boot } = await bootWith({ createKernl });
    const live = await boot(host, new URLSearchParams(), theme);
    expect(modules).toHaveBeenCalledWith({ theme, eventCache: expect.any(Function), shortcuts: { reserved: ['Alt+/'] }, torrent: live.downloads.torrent });
    expect(createKernl).toHaveBeenCalledWith({ host, builtins: shipped, modules: modules.mock.results[0]?.value });
    const preview = await boot(host, new URLSearchParams('preview=1'), theme);
    expect(createPreviewKernl).toHaveBeenCalledWith(host, preview.downloads.torrent, { builtins: shipped, theme });
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

  it('gives the preview no theme when the page has none', async () => {
    const { boot } = await bootWith({});
    const booted = await boot(host, new URLSearchParams('preview=1'));
    expect(createPreviewKernl).toHaveBeenCalledWith(host, booted.downloads.torrent, { builtins: shipped });
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

  it('downloads in kernl in the preview, through the host opener when handed off', async () => {
    const opened: string[] = [];
    const { boot } = await bootWith({});
    const booted = await boot({ ...host, openLink: (uri) => void opened.push(uri) }, new URLSearchParams('preview=1'));
    expect(booted.downloads.mode()).toBe('kernl');
    booted.downloads.setMode('device');
    await booted.downloads.torrent.add('ab'.repeat(20), [], { requester: 'shell' });
    expect(opened).toEqual([`magnet:?xt=urn:btih:${'ab'.repeat(20)}`]);
  });

  it.each([
    [new Error('relay pool exploded'), 'relay pool exploded'],
    ['plain words', 'plain words'],
  ])('falls back to the preview and says why when composing throws (%s)', async (thrown, words) => {
    const createKernl = (): never => {
      throw thrown;
    };
    const { boot } = await bootWith({ createKernl });
    const booted = await boot(host, new URLSearchParams());
    expect(booted).toMatchObject({ mode: 'preview', fallbackReason: `The live shell could not start (${words}).` });
  });

  it('falls back to the preview when the core cannot be loaded', async () => {
    const { boot } = await bootWith(() => {
      throw new Error('chunk missing');
    });
    const booted = await boot(host, new URLSearchParams());
    expect(booted.mode).toBe('preview');
    expect(booted.fallbackReason).toContain('The live shell could not start');
  });
});
