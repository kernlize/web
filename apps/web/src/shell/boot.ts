import type { Kernl, KernlOptions } from '@kernlize/core';
import { NostrConnectSigner } from 'applesauce-signers';
import type { Booted, KernlHost } from './contract';
import { openShellEventCache } from './event-cache';
import { canReachPeers, createShellDownloads, type ShellDownloads } from './downloads';
import { createPreviewTorrentClient } from './preview-downloads';
import { MESSAGES_APPLET } from './messages-applet';
import { createPreviewKernl } from './preview-kernl';
import type { ShellTheme } from './shell-theme';
import { loadWebTorrent } from './webtorrent-client';

/** The preview's downloads reach nobody, so they work in every browser. */
function previewDownloads(host: KernlHost): ShellDownloads {
  return createShellDownloads({ storage: host.storage, client: createPreviewTorrentClient(), open: (uri) => host.openLink(uri), inKernl: true });
}

function preview(host: KernlHost, theme: ShellTheme | undefined, fallbackReason?: string): Booted {
  const downloads = previewDownloads(host);
  const kernl = createPreviewKernl(host, downloads.torrent, { builtins: [MESSAGES_APPLET], ...(theme ? { theme } : {}) });
  const base = { kernl, mode: 'preview' as const, downloads };
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
 * preview takes over and says why. Either way the shell ships its messages
 * applet, and applets that ask for the theme are told the page's colours.
 */
export async function boot(host: KernlHost, search: URLSearchParams, theme?: ShellTheme): Promise<Booted> {
  if (search.get('preview') === '1') return preview(host, theme);
  try {
    const core = await import('@kernlize/core');
    if (!('createKernl' in core) || typeof core.createKernl !== 'function') return preview(host, theme, 'The live shell is not part of this build yet.');
    const createKernl = core.createKernl as (options: KernlOptions) => Kernl;
    // The library loads on the first download, never with the page (D-017).
    const downloads = createShellDownloads({ storage: host.storage, client: loadWebTorrent, open: (uri) => host.openLink(uri), inKernl: canReachPeers() });
    const kernl = createKernl({ host, torrent: downloads.torrent, builtins: [MESSAGES_APPLET], eventCache: openShellEventCache, ...(theme ? { theme } : {}) });
    NostrConnectSigner.pool = kernl.pool;
    return { kernl, mode: 'live', downloads };
  } catch (error) {
    return preview(host, theme, `The live shell could not start (${reasonOf(error)}).`);
  }
}
