import type { Kernl, KernlOptions } from '@kernl/core';
import { NostrConnectSigner } from 'applesauce-signers';
import type { Booted, KernlHost } from './contract';
import { SAMPLES } from './preview-applet';
import { createPreviewKernl } from './preview-kernl';

function preview(host: KernlHost, fallbackReason?: string): Booted {
  const base = { kernl: createPreviewKernl(host), mode: 'preview' as const, samples: SAMPLES };
  return fallbackReason === undefined ? base : { ...base, fallbackReason };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compose the live shell, or fall back to the preview.
 *
 * `?preview=1` asks for the preview outright. Otherwise the core is loaded on
 * demand; when it is missing `createKernl` or throws while composing, the
 * preview takes over and says why.
 */
export async function boot(host: KernlHost, search: URLSearchParams): Promise<Booted> {
  if (search.get('preview') === '1') return preview(host);
  try {
    const core = await import('@kernl/core');
    if (!('createKernl' in core) || typeof core.createKernl !== 'function') return preview(host, 'The live shell is not part of this build yet.');
    const createKernl = core.createKernl as (options: KernlOptions) => Kernl;
    const kernl = createKernl({ host });
    NostrConnectSigner.pool = kernl.pool;
    return { kernl, mode: 'live', samples: [] };
  } catch (error) {
    return preview(host, `The live shell could not start (${reasonOf(error)}).`);
  }
}
