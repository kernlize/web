import type { WebTorrentLike } from '@kernl/bridges';

/**
 * Loads the download library on the first download, so the shell's first chunk stays small and
 * applet frames never see it. The browser build reaches peers over WebRTC only (D-017).
 */
export async function loadWebTorrent(): Promise<WebTorrentLike> {
  const { default: WebTorrent } = await import('webtorrent/dist/webtorrent.min.js');
  return new WebTorrent() as WebTorrentLike;
}
