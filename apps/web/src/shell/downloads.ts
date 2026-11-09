import { createHandoffBackends, createWebTorrentBackend, type HandoffOpener, type TorrentBackend, type WebTorrentBackend, type WebTorrentLike } from '@kernlize/bridges';
import type { StorageLike } from './contract';

/** Where a link from peers goes: kernl downloads it, or an app on the device takes it. */
export type DownloadMode = 'kernl' | 'device';

export const DOWNLOAD_MODE_KEY = 'kernl:downloads:mode:v1';

/** The shell's downloads: the in-page engine, the user's choice, and the backend the bridge uses. */
export interface ShellDownloads {
  /** Jobs, progress and controls for the Downloads panel. */
  readonly engine: WebTorrentBackend;
  /** Follows the user's choice on every link; hand it to the torrent bridge. */
  readonly torrent: TorrentBackend;
  /** False when the browser cannot reach peers, so only the device app can take a link. */
  readonly inKernl: boolean;
  mode(): DownloadMode;
  setMode(mode: DownloadMode): void;
}

export interface ShellDownloadsOptions {
  readonly storage: StorageLike;
  readonly client: WebTorrentLike | (() => WebTorrentLike | Promise<WebTorrentLike>);
  /** The confirm-before-leaving opener the other bridges use (D-010). */
  readonly open: HandoffOpener;
  readonly inKernl: boolean;
}

/** Whether this browser can open peer connections at all. */
export function canReachPeers(scope: object = globalThis): boolean {
  return typeof (scope as { RTCPeerConnection?: unknown }).RTCPeerConnection === 'function';
}

/**
 * Downloading in kernl is the default where the browser can reach peers; the device app stays
 * a choice the user can make, remembered under {@link DOWNLOAD_MODE_KEY} (D-017).
 */
export function createShellDownloads(options: ShellDownloadsOptions): ShellDownloads {
  const engine = createWebTorrentBackend({ client: options.client });
  const handoff = createHandoffBackends(options.open).torrent;
  const stored = options.storage.getItem(DOWNLOAD_MODE_KEY);
  let mode: DownloadMode = options.inKernl && stored !== 'device' ? 'kernl' : 'device';
  const torrent: TorrentBackend = {
    get handoff() {
      return mode === 'device' ? true : undefined;
    },
    add: (...args) => (mode === 'kernl' ? engine.add(...args) : handoff.add(...args)),
  };
  return {
    engine,
    torrent,
    inKernl: options.inKernl,
    mode: () => mode,
    setMode(next) {
      mode = options.inKernl ? next : 'device';
      options.storage.setItem(DOWNLOAD_MODE_KEY, mode);
    },
  };
}
