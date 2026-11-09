import { expect, vi } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { createTorrentBridge, type Bridge, type BridgeResult, type DownloadJob, type DownloadState, type WebTorrentLike, type WebTorrentTorrentLike } from '@kernlize/bridges';
import { describeDownload } from '../../src/shell/download-words.ts';
import { MemoryStorage } from '../../../../packages/core/features/steps/world.ts';
import { DOWNLOAD_MODE_KEY, canReachPeers, createShellDownloads, type DownloadMode, type ShellDownloads } from '../../src/shell/downloads.ts';
import { createPreviewTorrentClient } from '../../src/shell/preview-downloads.ts';

interface DownloadsScratch {
  storage: MemoryStorage;
  inKernl: boolean;
  opened: string[];
  downloads: ShellDownloads;
  bridge: Bridge;
  result?: BridgeResult;
}

interface PreviewClientScratch {
  client: WebTorrentLike;
  ticks: (() => void)[];
  torrent?: WebTorrentTorrentLike;
  finished?: boolean;
}

interface DownloadsWorld {
  shellDownloads?: DownloadsScratch;
  previewClient?: PreviewClientScratch;
}

function start(storage: MemoryStorage, inKernl: boolean, opened: string[]): DownloadsScratch {
  const client = createPreviewTorrentClient(() => () => undefined);
  const downloads = createShellDownloads({ storage, client, open: (uri) => void opened.push(uri), inKernl });
  return { storage, inKernl, opened, downloads, bridge: createTorrentBridge(downloads.torrent) };
}

function shell(world: DownloadsWorld): DownloadsScratch {
  if (!world.shellDownloads) throw new Error('start shell downloads first');
  return world.shellDownloads;
}

function previewClient(world: DownloadsWorld): PreviewClientScratch {
  if (!world.previewClient) throw new Error('create a preview download client first');
  return world.previewClient;
}

function previewTorrent(world: DownloadsWorld): WebTorrentTorrentLike {
  const found = previewClient(world).torrent;
  if (!found) throw new Error('add a preview download first');
  return found;
}

Given('shell downloads where the browser {word} reach peers', (world: DownloadsWorld, can: string) => {
  world.shellDownloads = start(new MemoryStorage(), can === 'can', []);
});

When('shell downloads start again over the same storage', (world: DownloadsWorld) => {
  const { storage, inKernl, opened } = shell(world);
  world.shellDownloads = start(storage, inKernl, opened);
});

When('the user sends downloads to {string}', (world: DownloadsWorld, mode: DownloadMode) => {
  shell(world).downloads.setMode(mode);
});

Then('shell downloads go to {string}', (world: DownloadsWorld, mode: string) => {
  expect(shell(world).downloads.mode()).toBe(mode);
});

Then('the stored download choice is {string}', (world: DownloadsWorld, mode: string) => {
  expect(shell(world).storage.getItem(DOWNLOAD_MODE_KEY)).toBe(mode);
});

Then('the downloads bridge is ready in kernl', (world: DownloadsWorld) => {
  expect(shell(world).bridge.availability()).toEqual({ available: true });
});

Then('the downloads bridge hands off to the device', (world: DownloadsWorld) => {
  expect(shell(world).bridge.availability()).toEqual({ available: true, handoff: true });
});

When('the downloads bridge resolves {string}', async (world: DownloadsWorld, uri: string) => {
  const { parseLocator } = await import('@kernlize/bridges');
  shell(world).result = await shell(world).bridge.resolve(parseLocator(uri), { requester: 'shell' });
});

Then('the downloads bridge yields {string} and the device opened nothing', (world: DownloadsWorld, id: string) => {
  expect(shell(world).result).toMatchObject({ kind: 'job', id });
  expect(shell(world).opened).toEqual([]);
});

Then('the downloads bridge yields {string} and the device opened {int} link', (world: DownloadsWorld, id: string, count: number) => {
  expect(shell(world).result).toMatchObject({ kind: 'job', id });
  expect(shell(world).opened).toHaveLength(count);
});

Then('the shell has {int} download(s)', (world: DownloadsWorld, count: number) => {
  expect(shell(world).downloads.engine.jobs()).toHaveLength(count);
});

const BROWSERS: Readonly<Record<string, object | undefined>> = {
  'a browser with peer connections': { RTCPeerConnection: class {} },
  'a browser without peer connections': {},
  'the test runner': undefined,
};

Then(/^(a browser with peer connections|a browser without peer connections|the test runner) can reach peers: (yes|no)$/, (_world: DownloadsWorld, browser: string, answer: string) => {
  const scope = BROWSERS[browser];
  expect(scope === undefined ? canReachPeers() : canReachPeers(scope)).toBe(answer === 'yes');
});

Given('a preview download client', (world: DownloadsWorld) => {
  const ticks: (() => void)[] = [];
  const client = createPreviewTorrentClient((tick) => {
    ticks.push(tick);
    return () => ticks.splice(ticks.indexOf(tick), 1);
  });
  world.previewClient = { client, ticks };
});

Given('a preview download client on the page clock', (world: DownloadsWorld) => {
  vi.useFakeTimers();
  world.previewClient = { client: createPreviewTorrentClient(), ticks: [] };
});

After(() => {
  vi.useRealTimers();
});

When('the preview client adds {string}', (world: DownloadsWorld, magnet: string) => {
  const scratch = previewClient(world);
  scratch.torrent = scratch.client.add(magnet);
  scratch.torrent.on('done', () => {
    scratch.finished = true;
  });
});

When('the preview client removes the download', (world: DownloadsWorld) => {
  previewClient(world).client.remove(previewTorrent(world));
});

When('the preview clock ticks {int} time(s)', (world: DownloadsWorld, count: number) => {
  for (let index = 0; index < count; index += 1) for (const tick of previewClient(world).ticks.slice()) tick();
});

When('{int} milliseconds pass on the page clock', (_world: DownloadsWorld, ms: number) => {
  vi.advanceTimersByTime(ms);
});

When('the preview download is {word}', (world: DownloadsWorld, action: string) => {
  const torrent = previewTorrent(world);
  if (action === 'paused') torrent.pause();
  else torrent.resume();
});

Then('the preview download is {string} at {int} bytes with {int} peers', (world: DownloadsWorld, name: string, bytes: number, peers: number) => {
  const torrent = previewTorrent(world);
  expect(torrent.name ?? '-').toBe(name);
  expect(torrent.downloaded).toBe(bytes);
  expect(torrent.numPeers).toBe(peers);
  expect(torrent.done).toBe(false);
});

Then('the preview download is finished with {string} reading {string}', async (world: DownloadsWorld, name: string, words: string) => {
  const torrent = previewTorrent(world);
  expect(torrent.done).toBe(true);
  expect(previewClient(world).finished).toBe(true);
  expect(torrent.progress).toBe(1);
  expect(torrent.numPeers).toBe(0);
  expect(previewClient(world).ticks).toHaveLength(0);
  const [file] = torrent.files;
  expect(file?.name).toBe(name);
  expect(await file?.blob().then((blob) => blob.text())).toContain(words);
});

interface WordsWorld {
  job?: DownloadJob;
}

Given(
  'a download that is {string} with {int} of {word} bytes from {int} peers at {int} bytes a second',
  (world: WordsWorld, state: DownloadState, received: number, size: string, peers: number, speed: number) => {
    world.job = { id: 'download:1', name: 'x', infoHash: 'ab'.repeat(20), state, progress: 0, received, peers, speed, ...(size === '-' ? {} : { size: Number(size) }) };
  },
);

Given('a download that failed because {string}', (world: WordsWorld, error: string) => {
  world.job = { id: 'download:1', name: 'x', infoHash: 'ab'.repeat(20), state: 'failed', progress: 0, received: 0, peers: 0, speed: 0, error };
});

Then('the download reads {string}', (world: WordsWorld, words: string) => {
  if (!world.job) throw new Error('describe a download first');
  expect(describeDownload(world.job)).toBe(words);
});
