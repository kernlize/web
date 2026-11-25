import type { WebTorrentFileLike, WebTorrentLike, WebTorrentTorrentLike } from '@kernlize/bridges';

/** Starts a repeating timer and returns the function that stops it. */
export type Repeat = (tick: () => void, ms: number) => () => void;

const defaultRepeat: Repeat = (tick, ms) => {
  const timer = setInterval(tick, ms);
  return () => clearInterval(timer);
};

/** The preview's file: a short text so Save hands over something real. */
const PREVIEW_SIZE = 64 * 1024;
const STEPS = 8;
const PEERS = 3;
const TICK_MS = 400;

function nameOf(magnet: string): string {
  return new URLSearchParams(magnet.slice(magnet.indexOf('?') + 1)).get('dn') ?? 'Sample download';
}

class PreviewTorrent implements WebTorrentTorrentLike {
  name: string | undefined;
  length: number | undefined;
  downloaded = 0;
  downloadSpeed = 0;
  numPeers = 0;
  done = false;
  files: readonly WebTorrentFileLike[] = [];
  private readonly listeners = new Map<string, ((value?: unknown) => void)[]>();
  private stop: (() => void) | undefined;

  constructor(
    private readonly title: string,
    private readonly repeat: Repeat,
  ) {
    this.resume();
  }

  get progress(): number {
    return this.length ? this.downloaded / this.length : 0;
  }

  on(event: string, listener: (value?: unknown) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  pause(): void {
    this.stop?.();
    this.stop = undefined;
  }

  resume(): void {
    if (this.done || this.stop) return;
    this.stop = this.repeat(() => this.tick(), TICK_MS);
  }

  destroy(): void {
    this.pause();
  }

  private emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  private tick(): void {
    if (this.length === undefined) {
      this.name = this.title;
      this.length = PREVIEW_SIZE;
      this.numPeers = PEERS;
      const text = `${this.title}\n\nThis file came from the kernl preview. Nothing left your device.\n`;
      this.files = [{ name: `${this.title}.txt`, length: PREVIEW_SIZE, blob: async () => new Blob([text], { type: 'text/plain' }) }];
      this.emit('metadata');
      this.emit('wire');
      return;
    }
    const step = PREVIEW_SIZE / STEPS;
    this.downloaded = Math.min(PREVIEW_SIZE, this.downloaded + step);
    this.downloadSpeed = (step * 1000) / TICK_MS;
    this.emit('download');
    if (this.downloaded < PREVIEW_SIZE) return;
    this.done = true;
    this.numPeers = 0;
    this.pause();
    this.emit('done');
  }
}

/**
 * A download client that reaches nobody: each link fills in over a few seconds and finishes with
 * a short text file, so the preview's Downloads panel shows real progress and a real Save.
 */
export function createPreviewTorrentClient(repeat: Repeat = defaultRepeat): WebTorrentLike {
  return {
    add: (magnet) => new PreviewTorrent(nameOf(magnet), repeat),
    remove: (torrent) => (torrent as PreviewTorrent).destroy(),
  };
}
