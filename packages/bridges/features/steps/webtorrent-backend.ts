import { expect } from 'vitest';
import { DataTable, Given, Then, When } from 'quickpickle';
import {
  createTorrentBridge,
  createWebTorrentBackend,
  webTrackers,
  type DownloadJob,
  type WebTorrentBackend,
  type WebTorrentBackendOptions,
  type WebTorrentLike,
  type WebTorrentTorrentLike,
} from '@kernlize/bridges';
import { capture, expectReason, splitList, type BridgeWorld } from './world';

type Listener = (value?: unknown) => void;

class FakeTorrent implements WebTorrentTorrentLike {
  name: string | undefined;
  length: number | undefined;
  downloaded = 0;
  downloadSpeed = 0;
  numPeers = 0;
  done = false;
  files: { name: string; length: number; blob: () => Promise<Blob> }[] = [];
  readonly calls: string[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  get progress(): number {
    return this.length ? this.downloaded / this.length : 0;
  }

  on(event: string, listener: Listener): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string, value?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }

  pause(): void {
    this.calls.push('pause');
  }

  resume(): void {
    this.calls.push('resume');
  }
}

class FakeClient implements WebTorrentLike {
  readonly added: string[] = [];
  readonly torrents: FakeTorrent[] = [];
  readonly removed: { torrent: WebTorrentTorrentLike; destroyStore: boolean | undefined }[] = [];
  refuse: string | undefined;
  removeFails = false;

  add(magnet: string): WebTorrentTorrentLike {
    if (this.refuse !== undefined) throw new Error(this.refuse);
    this.added.push(magnet);
    const torrent = new FakeTorrent();
    this.torrents.push(torrent);
    return torrent;
  }

  remove(torrent: WebTorrentTorrentLike, options?: { destroyStore?: boolean }): Promise<void> {
    this.removed.push({ torrent, destroyStore: options?.destroyStore });
    return this.removeFails ? Promise.reject(new Error('gone')) : Promise.resolve();
  }
}

interface DownloadWorld extends BridgeWorld {
  client?: FakeClient;
  downloads?: WebTorrentBackend;
  clock?: { now: number };
  loads?: number;
  seen?: (readonly DownloadJob[])[];
  stop?: () => void;
  saved?: readonly { name: string; size: number; text: string }[];
}

function client(world: DownloadWorld): FakeClient {
  world.client ??= new FakeClient();
  return world.client;
}

function downloads(world: DownloadWorld): WebTorrentBackend {
  if (!world.downloads) throw new Error('no download backend');
  return world.downloads;
}

function torrent(world: DownloadWorld, index: number): FakeTorrent {
  const found = client(world).torrents[index - 1];
  if (!found) throw new Error(`no torrent ${index}`);
  return found;
}

function build(world: DownloadWorld, options: Omit<WebTorrentBackendOptions, 'client'>, source: WebTorrentBackendOptions['client']): void {
  world.downloads = createWebTorrentBackend({ ...options, client: source });
  world.bridge = createTorrentBridge(world.downloads);
}

function clocked(world: DownloadWorld, defaults: string): Omit<WebTorrentBackendOptions, 'client'> {
  const clock = { now: 0 };
  world.clock = clock;
  return { trackers: splitList(defaults), now: () => clock.now, progressIntervalMs: 500 };
}

Given('a download backend over a fake client announcing to {string}', (world: DownloadWorld, defaults: string) => {
  build(world, clocked(world, defaults), client(world));
});

Given('a download backend that loads a fake client announcing to {string}', (world: DownloadWorld, defaults: string) => {
  world.loads = 0;
  build(world, clocked(world, defaults), async () => {
    world.loads = (world.loads ?? 0) + 1;
    return client(world);
  });
});

Given('a download backend with default options', (world: DownloadWorld) => {
  build(world, {}, client(world));
});

Given('a download backend whose client fails to load once with {string}', (world: DownloadWorld, reason: string) => {
  world.loads = 0;
  build(world, clocked(world, ''), () => {
    world.loads = (world.loads ?? 0) + 1;
    if (world.loads === 1) throw new Error(reason);
    return client(world);
  });
});

Given('a download backend whose client fails to load with a bare string', (world: DownloadWorld) => {
  build(world, clocked(world, ''), () => Promise.reject('no peers here'));
});

Given('the fake client refuses new downloads with {string}', (world: DownloadWorld, reason: string) => {
  client(world).refuse = reason;
});

Given('the fake client fails to remove downloads', (world: DownloadWorld) => {
  client(world).removeFails = true;
});

Given('a downloads listener', (world: DownloadWorld) => {
  const seen: (readonly DownloadJob[])[] = [];
  world.seen = seen;
  world.stop = downloads(world).subscribe((jobs) => seen.push(jobs));
});

When('the downloads listener stops', (world: DownloadWorld) => {
  world.stop?.();
});

When('the download backend adds the hash {string}', async (world: DownloadWorld, hash: string) => {
  await capture(world, () => downloads(world).add(hash, [], { requester: 'shell' }));
});

When('the clock reads {int}', (world: DownloadWorld, now: number) => {
  if (world.clock) world.clock.now = now;
});

When('torrent {int} learns it is {string} of {int} bytes', (world: DownloadWorld, index: number, name: string, size: number) => {
  const found = torrent(world, index);
  found.name = name;
  found.length = size;
  found.files = [{ name, length: size, blob: async () => new Blob([`bytes of ${name}`]) }];
  found.emit('metadata');
});

When('torrent {int} meets {int} peers', (world: DownloadWorld, index: number, peers: number) => {
  const found = torrent(world, index);
  found.numPeers = peers;
  found.emit('wire');
});

When('torrent {int} has received {int} bytes at {int} bytes per second', (world: DownloadWorld, index: number, bytes: number, speed: number) => {
  const found = torrent(world, index);
  found.downloaded = bytes;
  found.downloadSpeed = speed;
  found.emit('download');
});

When('torrent {int} finishes', (world: DownloadWorld, index: number) => {
  const found = torrent(world, index);
  found.downloaded = found.length ?? 0;
  found.done = true;
  found.emit('done');
});

When('torrent {int} fails with {string}', (world: DownloadWorld, index: number, reason: string) => {
  torrent(world, index).emit('error', new Error(reason));
});

When('torrent {int} fails with a bare string', (world: DownloadWorld, index: number) => {
  torrent(world, index).emit('error', 'wire dropped');
});

When('the user {word} download {string}', async (world: DownloadWorld, action: string, id: string) => {
  await capture(world, async () => {
    const backend = downloads(world);
    if (action === 'pauses') backend.pause(id);
    else if (action === 'resumes') backend.resume(id);
    else if (action === 'removes') backend.remove(id);
    else {
      const files = await backend.files(id);
      world.saved = await Promise.all(files.map(async (file) => ({ name: file.name, size: file.size, text: await file.blob.text() })));
    }
    return undefined;
  });
  await Promise.resolve();
});

Then('the fake client was asked to add {string}', (world: DownloadWorld, magnet: string) => {
  expect(client(world).added).toEqual([magnet]);
});

Then('the fake client was asked to add nothing', (world: DownloadWorld) => {
  expect(client(world).added).toEqual([]);
});

Then('the fake client was loaded {int} time(s)', (world: DownloadWorld, times: number) => {
  expect(world.loads).toBe(times);
});

Then('torrent {int} was told to {word}', (world: DownloadWorld, index: number, call: string) => {
  expect(torrent(world, index).calls.at(-1)).toBe(call);
});

Then('torrent {int} was removed with its stored data', (world: DownloadWorld, index: number) => {
  expect(client(world).removed).toEqual([{ torrent: torrent(world, index), destroyStore: true }]);
});

Then('the download action fails with {string}', (world: DownloadWorld, reason: string) => {
  expectReason(world.error, reason);
});

Then('the download action succeeds', (world: DownloadWorld) => {
  expect(world.error).toBeUndefined();
});

function rowOf(job: DownloadJob, columns: readonly string[]): Record<string, string> {
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(job));
  return Object.fromEntries(columns.map((column) => [column, record[column] === undefined ? '-' : String(record[column])]));
}

Then('the downloads are', (world: DownloadWorld, table: DataTable) => {
  const expected = table.hashes();
  const columns = Object.keys(expected[0] ?? {});
  expect(downloads(world).jobs().map((job) => rowOf(job, columns))).toEqual(expected);
});

Then('there are no downloads', (world: DownloadWorld) => {
  expect(downloads(world).jobs()).toEqual([]);
});

Then('the downloads listener heard {int} update(s)', (world: DownloadWorld, count: number) => {
  expect(world.seen).toHaveLength(count);
});

Then('the saved files are', (world: DownloadWorld, table: DataTable) => {
  expect(world.saved?.map((file) => ({ name: file.name, size: String(file.size), text: file.text }))).toEqual(table.hashes());
});

Then('the reachable trackers of {string} are {string}', (_world: DownloadWorld, given: string, expected: string) => {
  expect(webTrackers(splitList(given))).toEqual(splitList(expected));
});
