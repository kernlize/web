import { magnetInfoHash, readTorrentMetainfo } from '@kernlize/bridges';
import type { ClientProbe, TorrentClient, TorrentClientFile, TorrentClientJob, TorrentClientLimits, TorrentClientSource } from '@kernlize/bridges';

/** One torrent as the in-memory program holds it. */
interface MemoryTorrent {
  readonly infoHash: string;
  name: string;
  hasMetadata: boolean;
  finished: boolean;
  paused: boolean;
  problem?: string;
  private?: boolean;
  downloadedBytes: number;
  uploadedBytes: number;
  totalBytes?: number;
  downloadLimit: number;
  uploadLimit: number;
  files: TorrentClientFile[];
}

/**
 * A torrent program that lives in memory and keeps the `TorrentClient` contract the way
 * a real one does: it holds torrents by info hash, moves them through their phases,
 * rejects with the contract's reasons, and remembers every call it was sent. The hooks
 * below the contract's methods are the outside world: the swarm delivering bytes, the
 * person acting in the program's own window, the network going away.
 */
export class MemoryTorrentClient implements TorrentClient {
  /** Every call received, as `method` or `method:infoHash`, in order. */
  readonly calls: string[] = [];
  /** Info hashes whose data the program was told to delete. */
  readonly deleted: string[] = [];
  private readonly torrents = new Map<string, MemoryTorrent>();
  private outage: { readonly reason: string; readonly method?: string } | undefined;

  /** From now on every call, or every call of one method, rejects with this reason. */
  failWith(reason: string, method?: string): void {
    this.outage = method === undefined ? { reason } : { reason, method };
  }

  recover(): void {
    this.outage = undefined;
  }

  has(infoHash: string): boolean {
    return this.torrents.has(infoHash);
  }

  /** The swarm delivers the torrent's metadata. */
  learn(infoHash: string, name: string, isPrivate: boolean | undefined): void {
    const torrent = this.held(infoHash);
    const file = (index: number, leaf: string, size: number): TorrentClientFile => ({ index, path: `${name}/${leaf}`, size, downloadedBytes: 0, selected: true, priority: 0 });
    Object.assign(torrent, { name, hasMetadata: true, totalBytes: 1000, files: [file(0, 'a.bin', 600), file(1, 'b.bin', 400), file(2, 'empty.txt', 0)] });
    if (isPrivate === undefined) delete torrent.private;
    else torrent.private = isPrivate;
  }

  /** The swarm has delivered this many bytes, the first file first. */
  download(infoHash: string, bytes: number): void {
    const torrent = this.held(infoHash);
    torrent.downloadedBytes = bytes;
    let left = bytes;
    torrent.files = torrent.files.map((file) => {
      const got = Math.min(left, file.size);
      left -= got;
      return { ...file, downloadedBytes: got };
    });
    torrent.finished = bytes === torrent.totalBytes;
  }

  upload(infoHash: string, bytes: number): void {
    this.held(infoHash).uploadedBytes = bytes;
  }

  /** The person removes the torrent in the program's own window. */
  lose(infoHash: string): void {
    this.torrents.delete(infoHash);
  }

  report(infoHash: string, problem: string): void {
    this.held(infoHash).problem = problem;
  }

  /** The person changes a torrent's limits in the program's own window. */
  limit(infoHash: string, limits: Required<TorrentClientLimits>): void {
    Object.assign(this.held(infoHash), limits);
  }

  snapshot(infoHash: string): TorrentClientJob | undefined {
    const torrent = this.torrents.get(infoHash);
    return torrent ? this.reported(torrent) : undefined;
  }

  async probe(): Promise<ClientProbe> {
    this.enter('probe');
    return { version: 'memory 1.0' };
  }

  async add(source: TorrentClientSource, options?: { readonly paused?: boolean }): Promise<{ readonly infoHash: string }> {
    this.enter('add');
    const fresh = source.kind === 'magnet' ? this.fromMagnet(source.magnet) : await this.fromMetainfo(source.bytes);
    const held = this.torrents.get(fresh.infoHash);
    if (held) return { infoHash: held.infoHash };
    this.torrents.set(fresh.infoHash, { ...fresh, paused: options?.paused === true });
    this.calls.push(`added:${fresh.infoHash}:${options?.paused === true ? 'paused' : 'started'}`);
    return { infoHash: fresh.infoHash };
  }

  async list(): Promise<readonly TorrentClientJob[]> {
    this.enter('list');
    return [...this.torrents.values()].map((torrent) => this.reported(torrent));
  }

  async get(infoHash: string): Promise<TorrentClientJob | undefined> {
    this.enter('get', infoHash);
    return this.snapshot(infoHash);
  }

  async files(infoHash: string): Promise<readonly TorrentClientFile[]> {
    this.enter('files', infoHash);
    return this.held(infoHash).files.map((file) => ({ ...file }));
  }

  async selectFiles(infoHash: string, indexes: readonly number[], change: { readonly selected?: boolean; readonly priority?: number }): Promise<void> {
    this.enter('selectFiles', infoHash);
    const torrent = this.held(infoHash);
    if (indexes.some((index) => !torrent.files.some((file) => file.index === index))) throw new Error('invalid:file-index');
    torrent.files = torrent.files.map((file) => (indexes.includes(file.index) ? { ...file, ...change } : file));
  }

  async pause(infoHash: string): Promise<void> {
    this.enter('pause', infoHash);
    this.held(infoHash).paused = true;
  }

  async resume(infoHash: string): Promise<void> {
    this.enter('resume', infoHash);
    this.held(infoHash).paused = false;
  }

  async remove(infoHash: string, deleteData: boolean): Promise<void> {
    this.enter('remove', infoHash);
    this.held(infoHash);
    this.torrents.delete(infoHash);
    if (deleteData) this.deleted.push(infoHash);
  }

  async setLimits(infoHash: string, limits: TorrentClientLimits): Promise<void> {
    this.enter('setLimits', infoHash);
    Object.assign(this.held(infoHash), limits);
  }

  private enter(method: string, infoHash?: string): void {
    this.calls.push(infoHash === undefined ? method : `${method}:${infoHash}`);
    if (this.outage && (this.outage.method ?? method) === method) throw new Error(this.outage.reason);
  }

  private held(infoHash: string): MemoryTorrent {
    const torrent = this.torrents.get(infoHash);
    if (!torrent) throw new Error('unavailable:not-found');
    return torrent;
  }

  private blank(infoHash: string, name: string): Omit<MemoryTorrent, 'paused'> {
    return { infoHash, name, hasMetadata: false, finished: false, downloadedBytes: 0, uploadedBytes: 0, downloadLimit: 0, uploadLimit: 0, files: [] };
  }

  private fromMagnet(magnet: string): Omit<MemoryTorrent, 'paused'> {
    const name = new URLSearchParams(magnet.slice(magnet.indexOf('?') + 1)).get('dn') ?? '';
    return this.blank(magnetInfoHash(magnet), name);
  }

  private async fromMetainfo(bytes: Uint8Array): Promise<Omit<MemoryTorrent, 'paused'>> {
    const metainfo = await readTorrentMetainfo(bytes).catch(() => {
      throw new Error('unavailable:rejected');
    });
    const files = metainfo.files.map((file, index) => ({ index, path: file.path, size: file.size, downloadedBytes: 0, selected: true, priority: 0 }));
    return { ...this.blank(metainfo.infoHash, metainfo.name), hasMetadata: true, totalBytes: metainfo.totalBytes, private: metainfo.private, files };
  }

  private state(torrent: MemoryTorrent): TorrentClientJob['state'] {
    if (torrent.problem !== undefined) return 'error';
    if (torrent.paused) return 'paused';
    if (!torrent.hasMetadata) return 'metadata';
    return torrent.finished ? 'seeding' : 'downloading';
  }

  private reported(torrent: MemoryTorrent): TorrentClientJob {
    const state = this.state(torrent);
    const moving = state === 'downloading' && torrent.downloadedBytes > 0;
    const { infoHash, name, downloadedBytes, uploadedBytes, totalBytes, downloadLimit, uploadLimit } = torrent;
    return {
      infoHash, name, state, downloadedBytes, uploadedBytes, downloadLimit, uploadLimit,
      downloadRate: moving ? 50 : 0,
      uploadRate: state === 'seeding' ? 20 : 0,
      peers: moving ? 3 : 0,
      seeds: moving ? 2 : 0,
      leeches: moving ? 1 : 0,
      ...(totalBytes === undefined ? {} : { totalBytes, progress: downloadedBytes / totalBytes }),
      ...(moving && totalBytes !== undefined ? { etaSeconds: (totalBytes - downloadedBytes) / 50 } : {}),
      ...(torrent.private === undefined ? {} : { private: torrent.private }),
      ...(torrent.problem === undefined ? {} : { error: torrent.problem }),
    };
  }
}
