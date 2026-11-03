import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KernlHost } from './contract';

const host: KernlHost = {
  storage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  presentConsent: () => undefined,
  notify: () => undefined,
  openLink: () => undefined,
  getVisibility: () => ({ visible: true, focused: true }),
  onRevoked: () => undefined,
};
const previewKernl = { kind: 'preview kernl' };
const signers = { NostrConnectSigner: { pool: undefined as unknown } };

async function bootWith(core: Record<string, unknown> | (() => never)): Promise<typeof import('./boot')> {
  vi.resetModules();
  vi.doMock('./preview-kernl', () => ({ createPreviewKernl: vi.fn(() => previewKernl) }));
  vi.doMock('applesauce-signers', () => signers);
  vi.doMock('@kernl/core', () => (typeof core === 'function' ? core() : core));
  return import('./boot');
}

afterEach(() => {
  vi.doUnmock('./preview-kernl');
  vi.doUnmock('applesauce-signers');
  vi.doUnmock('@kernl/core');
  signers.NostrConnectSigner.pool = undefined;
});

describe('boot', () => {
  it('starts the preview outright when the address asks for it', async () => {
    const { boot } = await bootWith({});
    const booted = await boot(host, new URLSearchParams('preview=1'));
    expect(booted.kernl).toBe(previewKernl);
    expect(booted.mode).toBe('preview');
    expect(booted.samples.length).toBeGreaterThan(0);
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
    expect(createKernl).toHaveBeenCalledWith({ host });
    expect(booted).toEqual({ kernl: live, mode: 'live', samples: [] });
    expect(signers.NostrConnectSigner.pool).toBe(live.pool);
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
