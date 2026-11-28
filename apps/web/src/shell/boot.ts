import { NostrConnectSigner } from 'applesauce-signers';
import type { Booted, KernlHost } from './contract';
import { openShellEventCache } from './event-cache';
import { canReachPeers, createShellDownloads } from './downloads';
import { MESSAGES_APPLET } from './messages-applet';
import { browserOutboxCache } from './outbox-cache';
import { createPreviewTorrentClient } from './offline-torrent';
import type { ShellTheme } from './shell-theme';
import { SHELL_CHORDS } from './shortcuts';
import { loadWebTorrent } from './webtorrent-client';

/**
 * The real kernel and kernl's modules over parts that live in the page (D-068). The kernel, the
 * preset and the sample applets load on demand, as the live shell's do. Its downloads reach
 * nobody, so they work in every browser.
 */
async function preview(host: KernlHost, theme: ShellTheme | undefined): Promise<Booted> {
  const [preset, samples] = await Promise.all([import('@kernlize/preset'), import('./sample-applets').then((module) => module.loadSampleApplets())]);
  const downloads = createShellDownloads({ storage: host.storage, client: createPreviewTorrentClient(), open: (uri) => host.openLink(uri), inKernl: true });
  const parts = preset.previewPreset({ ...samples, torrent: downloads.torrent, ...(theme ? { theme } : {}) });
  const kernl = preset.createKernl({ ...parts.options(host), builtins: [MESSAGES_APPLET] });
  return { kernl, mode: 'preview', downloads };
}

async function live(host: KernlHost, theme: ShellTheme | undefined): Promise<Booted> {
  const [core, preset] = await Promise.all([import('@kernlize/core'), import('@kernlize/preset')]);
  if (!('createKernl' in core) || typeof core.createKernl !== 'function') throw new Error('This build has no live shell.');
  // The library loads on the first download, never with the page (D-017).
  const downloads = createShellDownloads({ storage: host.storage, client: loadWebTorrent, open: (uri) => host.openLink(uri), inKernl: canReachPeers() });
  // kernl.run runs the kernel with kernl's preset (D-068). Naming the modules is what types `kernl.theme`, the only thing that may publish a colour change (D-064).
  // A shell that names them hands the theme, the event cache, its reserved shortcuts and its torrent engine to the modules; `createKernl` reads none of them (D-062).
  // The settings form is the host's `settings.present` renderer, which the settings module draws through (D-067).
  const modules = preset.kernlPreset({ eventCache: openShellEventCache, shortcuts: { reserved: SHELL_CHORDS }, torrent: downloads.torrent, ...(theme ? { theme } : {}) });
  const sessionCache = browserOutboxCache();
  const kernl = core.createKernl({ host: sessionCache ? { ...host, outboxCache: sessionCache } : host, builtins: [MESSAGES_APPLET], modules });
  NostrConnectSigner.pool = kernl.pool;
  return { kernl, mode: 'live', downloads };
}

/**
 * Compose the shell: the live one, or the preview when `?preview=1` asks for it.
 *
 * Both run the real kernel, loaded on demand. When it cannot be loaded or composed, the promise
 * rejects with the reason, and the page says so; there is no stand-in shell. Either way the shell
 * ships its messages applet, and applets that ask for the theme are told the page's colours: once
 * when they open, and again whenever the page's colours change (D-064).
 *
 * @param host - The UI's side of the contract; the preview's storage is already scoped apart.
 * @param search - The page's query, where `preview=1` asks for the preview.
 * @param theme - The page's colours when the shell starts.
 * @returns The composed shell, its mode and its downloads.
 * @example
 * ```ts
 * const booted = await boot(host, new URLSearchParams(location.search), theme);
 * ```
 */
export function boot(host: KernlHost, search: URLSearchParams, theme?: ShellTheme): Promise<Booted> {
  return search.get('preview') === '1' ? preview(host, theme) : live(host, theme);
}
