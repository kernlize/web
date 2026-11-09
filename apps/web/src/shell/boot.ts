import type { Kernl, KernlOptions } from '@kernlize/core';
import { NostrConnectSigner } from 'applesauce-signers';
import type { Booted, KernlHost } from './contract';
import { canReachPeers, createShellDownloads, type ShellDownloads } from './downloads';
import { SAMPLES } from './preview-applet';
import { createPreviewTorrentClient } from './preview-downloads';
import { createPreviewKernl } from './preview-kernl';
import { loadWebTorrent } from './webtorrent-client';

/** The preview's downloads reach nobody, so they work in every browser. */
function previewDownloads(host: KernlHost): ShellDownloads {
  return createShellDownloads({ storage: host.storage, client: createPreviewTorrentClient(), open: (uri) => host.openLink(uri), inKernl: true });
}

function preview(host: KernlHost, fallbackReason?: string): Booted {
  const downloads = previewDownloads(host);
  const base = { kernl: createPreviewKernl(host, downloads.torrent), mode: 'preview' as const, samples: SAMPLES, downloads };
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
    const core = await import('@kernlize/core');
    if (!('createKernl' in core) || typeof core.createKernl !== 'function') return preview(host, 'The live shell is not part of this build yet.');
    const createKernl = core.createKernl as (options: KernlOptions) => Kernl;
    // The library loads on the first download, never with the page (D-017).
    const downloads = createShellDownloads({ storage: host.storage, client: loadWebTorrent, open: (uri) => host.openLink(uri), inKernl: canReachPeers() });
    const kernl = createKernl({ host, torrent: downloads.torrent });
    NostrConnectSigner.pool = kernl.pool;
    return { kernl, mode: 'live', samples: [], downloads };
  } catch (error) {
    return preview(host, `The live shell could not start (${reasonOf(error)}).`);
  }
}
