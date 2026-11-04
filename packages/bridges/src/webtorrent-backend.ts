import type { BridgeContext, TorrentBackend } from './types';

/** The part of a WebTorrent file the backend reads. */
export interface WebTorrentFileLike {
  readonly name: string;
  readonly length: number;
  blob(): Promise<Blob>;
}

/** The part of a WebTorrent torrent the backend reads, so `@kernl/bridges` stays free of the library. */
export interface WebTorrentTorrentLike {
  readonly name?: string | undefined;
  readonly length?: number | undefined;
  readonly downloaded: number;
  readonly progress: number;
  readonly downloadSpeed: number;
  readonly numPeers: number;
  readonly done: boolean;
  readonly files: readonly WebTorrentFileLike[];
  on(event: 'metadata' | 'ready' | 'download' | 'done' | 'wire' | 'noPeers', listener: () => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  pause(): void;
  resume(): void;
}

/** The part of a WebTorrent client the backend calls. */
export interface WebTorrentLike {
  add(magnet: string): WebTorrentTorrentLike;
  remove(torrent: WebTorrentTorrentLike, options?: { readonly destroyStore?: boolean }): unknown;
}

/** Where a download stands. */
export type DownloadState = 'connecting' | 'downloading' | 'paused' | 'done' | 'failed';

/** A download as the user sees it. Sizes are bytes; `progress` runs from 0 to 1. */
export interface DownloadJob {
  readonly id: string;
  readonly name: string;
  readonly infoHash: string;
  readonly state: DownloadState;
  readonly progress: number;
  readonly received: number;
  /** Unknown until the swarm has sent the file list. */
  readonly size?: number;
  readonly peers: number;
  /** Bytes per second. */
  readonly speed: number;
  /** Why it failed, when it did. */
  readonly error?: string;
}

/** A finished file, ready to save. */
export interface DownloadedFile {
  readonly name: string;
  readonly size: number;
  readonly blob: Blob;
}

/** Called with every job, in the order they were added, whenever one changes. */
export type DownloadListener = (jobs: readonly DownloadJob[]) => void;

/** A torrent backend that downloads inside the page and reports its jobs. */
export interface WebTorrentBackend extends TorrentBackend {
  jobs(): readonly DownloadJob[];
  /** Calls `listener` now and on every change; the returned function stops it. */
  subscribe(listener: DownloadListener): () => void;
  /** @throws `denied:unknown-download` */
  pause(id: string): void;
  /** @throws `denied:unknown-download` */
  resume(id: string): void;
  /** Stops the download and drops what it stored. @throws `denied:unknown-download` */
  remove(id: string): void;
  /** @throws `denied:unknown-download`, `unavailable:not-finished` */
  files(id: string): Promise<readonly DownloadedFile[]>;
}

/** Options for {@link createWebTorrentBackend}. */
export interface WebTorrentBackendOptions {
  /** The client, or a loader that creates it on the first download so the library loads only when used. */
  readonly client: WebTorrentLike | (() => WebTorrentLike | Promise<WebTorrentLike>);
  /** Peer-finding servers announced to on every download; defaults to {@link DEFAULT_WEBRTC_TRACKERS}. */
  readonly trackers?: readonly string[];
  /** Clock for progress throttling; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Least time between two progress-only notifications; defaults to 500 ms. */
  readonly progressIntervalMs?: number;
}

/**
 * Public WebRTC trackers. A page can only reach peers over WebRTC, and only a `wss://`
 * tracker introduces it to them (D-017).
 *
 * @example
 * ```ts
 * createWebTorrentBackend({ client, trackers: [...DEFAULT_WEBRTC_TRACKERS, 'wss://tracker.example'] });
 * ```
 */
export const DEFAULT_WEBRTC_TRACKERS: readonly string[] = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.btorrent.xyz',
];

const INFO_HASH = /^[0-9a-f]{40}$/;

interface Entry {
  readonly id: string;
  readonly infoHash: string;
  readonly fallbackName: string;
  readonly torrent: WebTorrentTorrentLike;
  readonly client: WebTorrentLike;
  paused: boolean;
  error?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A tracker the page can reach: browsers cannot open UDP or plain TCP sockets. */
function reachable(tracker: string): boolean {
  return tracker.toLowerCase().startsWith('wss://');
}

/**
 * Keeps the link's reachable trackers ahead of the defaults, without duplicates.
 *
 * @param trackers - Trackers from the link.
 * @param defaults - Trackers always announced to.
 * @returns The `wss://` trackers to announce to.
 * @example
 * ```ts
 * webTrackers(['udp://t.example:80', 'wss://t.example'], ['wss://d.example']);
 * // ['wss://t.example', 'wss://d.example']
 * ```
 */
export function webTrackers(trackers: readonly string[], defaults: readonly string[] = DEFAULT_WEBRTC_TRACKERS): readonly string[] {
  return [...new Set([...trackers.filter(reachable), ...defaults.filter(reachable)])];
}

function magnetOf(infoHash: string, trackers: readonly string[], name: string | undefined): string {
  const params = [...(name === undefined ? [] : [`dn=${encodeURIComponent(name)}`]), ...trackers.map((tracker) => `tr=${encodeURIComponent(tracker)}`)];
  return `magnet:?xt=urn:btih:${infoHash}${params.length ? `&${params.join('&')}` : ''}`;
}

function stateOf(entry: Entry): DownloadState {
  if (entry.error !== undefined) return 'failed';
  if (entry.torrent.done) return 'done';
  if (entry.paused) return 'paused';
  return entry.torrent.numPeers > 0 ? 'downloading' : 'connecting';
}

function snapshot(entry: Entry): DownloadJob {
  const { torrent } = entry;
  const state = stateOf(entry);
  return {
    id: entry.id,
    name: torrent.name ?? entry.fallbackName,
    infoHash: entry.infoHash,
    state,
    progress: torrent.progress,
    received: torrent.downloaded,
    ...(torrent.length === undefined ? {} : { size: torrent.length }),
    peers: torrent.numPeers,
    speed: state === 'downloading' ? torrent.downloadSpeed : 0,
    ...(entry.error === undefined ? {} : { error: entry.error }),
  };
}

function loaderOf(client: WebTorrentBackendOptions['client']): () => Promise<WebTorrentLike> {
  let loading: Promise<WebTorrentLike> | undefined;
  return () => {
    loading ??= Promise.resolve()
      .then(() => (typeof client === 'function' ? client() : client))
      .catch((error: unknown) => {
        loading = undefined;
        throw new Error(`unavailable:${messageOf(error)}`);
      });
    return loading;
  };
}

/**
 * Creates a torrent backend that downloads inside the page through a WebTorrent client,
 * which reaches peers over WebRTC only. It announces to the link's `wss://` trackers plus
 * the defaults and drops the rest, since a page cannot open the sockets they need (D-017).
 * The backend carries no `handoff` trait, so `describeBridge` reports the transfer as
 * kernl's own; peers still see the user's address and what they fetch.
 *
 * @param options - The client or its loader, trackers, and progress throttling.
 * @returns A backend with the job list and controls the Downloads panel uses.
 * @throws From `add`: `invalid:info-hash` for a hash that is not 40 hex characters, `unavailable:<why>` when the client cannot load or add.
 * @example
 * ```ts
 * const downloads = createWebTorrentBackend({ client: async () => new (await import('webtorrent')).default() });
 * const bridge = createTorrentBridge(downloads);
 * await bridge.resolve(parseLocator(magnetLink), { requester: 'shell' });
 * downloads.subscribe((jobs) => render(jobs));
 * ```
 */
export function createWebTorrentBackend(options: WebTorrentBackendOptions): WebTorrentBackend {
  const load = loaderOf(options.client);
  const defaults = options.trackers ?? DEFAULT_WEBRTC_TRACKERS;
  const now = options.now ?? Date.now;
  const interval = options.progressIntervalMs ?? 500;
  const entries = new Map<string, Entry>();
  const listeners = new Set<DownloadListener>();
  let count = 0;
  let lastProgress = Number.NEGATIVE_INFINITY;

  const jobs = (): readonly DownloadJob[] => [...entries.values()].map(snapshot);
  const notify = (): void => {
    const current = jobs();
    for (const listener of listeners) listener(current);
  };
  const onProgress = (): void => {
    if (now() - lastProgress < interval) return;
    lastProgress = now();
    notify();
  };
  const entryOf = (id: string): Entry => {
    const entry = entries.get(id);
    if (!entry) throw new Error('denied:unknown-download');
    return entry;
  };

  const watch = (entry: Entry): void => {
    const { torrent } = entry;
    for (const event of ['metadata', 'ready', 'done', 'wire', 'noPeers'] as const) torrent.on(event, notify);
    torrent.on('download', onProgress);
    torrent.on('error', (error) => {
      entry.error = messageOf(error);
      notify();
    });
  };

  const add = async (infoHash: string, trackers: readonly string[], _context: BridgeContext, name?: string): Promise<{ id: string; name: string }> => {
    const hash = infoHash.toLowerCase();
    if (!INFO_HASH.test(hash)) throw new Error('invalid:info-hash');
    const client = await load();
    const existing = [...entries.values()].find((entry) => entry.infoHash === hash);
    if (existing) return { id: existing.id, name: snapshot(existing).name };
    let torrent: WebTorrentTorrentLike;
    try {
      torrent = client.add(magnetOf(hash, webTrackers(trackers, defaults), name));
    } catch (error) {
      throw new Error(`unavailable:${messageOf(error)}`);
    }
    count += 1;
    const entry: Entry = { id: `download:${count}`, infoHash: hash, fallbackName: name ?? hash, torrent, client, paused: false };
    entries.set(entry.id, entry);
    watch(entry);
    notify();
    return { id: entry.id, name: snapshot(entry).name };
  };

  return {
    add,
    jobs,
    subscribe(listener) {
      listeners.add(listener);
      listener(jobs());
      return () => void listeners.delete(listener);
    },
    pause(id) {
      const entry = entryOf(id);
      entry.torrent.pause();
      entry.paused = true;
      notify();
    },
    resume(id) {
      const entry = entryOf(id);
      entry.torrent.resume();
      entry.paused = false;
      notify();
    },
    remove(id) {
      const entry = entryOf(id);
      entries.delete(id);
      // The client may reject asynchronously; the job is already gone from the list either way.
      void Promise.resolve()
        .then(() => entry.client.remove(entry.torrent, { destroyStore: true }))
        .catch(() => undefined);
      notify();
    },
    async files(id) {
      const { torrent } = entryOf(id);
      if (!torrent.done) throw new Error('unavailable:not-finished');
      return Promise.all(torrent.files.map(async (file) => ({ name: file.name, size: file.length, blob: await file.blob() })));
    },
  };
}
