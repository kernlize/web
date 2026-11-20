import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import { magnetInfoHash, readTorrentMetainfo } from '../../src/clients/torrent-metainfo';
import type { TorrentMetainfo } from '../../src/clients/types';
import { bencode, decodeTorrent, folderTorrent, pieces, singleFileTorrent, type Bencodable } from './fake-transmission-torrents';
import { expectReason, reasonOf } from './world';

interface MetainfoState {
  bytes?: Uint8Array;
  metainfo?: TorrentMetainfo;
  hash?: string;
  error?: unknown;
}

const states = new WeakMap<object, MetainfoState>();

function stateOf(world: object): MetainfoState {
  let state = states.get(world);
  if (!state) states.set(world, (state = {}));
  return state;
}

const INFO = { length: 40_000, name: 'night-mix.flac', 'piece length': 16_384, pieces: pieces(3) } as const;

function withInfo(info: Bencodable, extra: { readonly [key: string]: Bencodable } = {}): Buffer {
  return bencode({ ...extra, info });
}

function withFile(file: Bencodable): Buffer {
  return withInfo({ files: [file], name: 'folder', 'piece length': 16_384, pieces: pieces(1) });
}

function without(key: keyof typeof INFO): { readonly [key: string]: Bencodable } {
  return Object.fromEntries(Object.entries(INFO).filter(([name]) => name !== key));
}

function nested(depth: number): Buffer {
  return Buffer.from(`${'l'.repeat(depth)}${'e'.repeat(depth)}`);
}

/** Every defect is one departure from a torrent that would otherwise read. */
const DEFECTS: Record<string, () => Uint8Array> = {
  'is empty': () => new Uint8Array(),
  'is plain text': () => Buffer.from('this is not a torrent'),
  'is a list instead of a dictionary': () => bencode([INFO]),
  'stops in the middle': () => singleFileTorrent().subarray(0, 60),
  'has bytes after its end': () => Buffer.concat([singleFileTorrent(), Buffer.from('x')]),
  'is nested deeper than any torrent': () => Buffer.from(`d4:info${nested(40)}e`),
  'is larger than any torrent': () => new Uint8Array(32 * 1024 * 1024 + 1),
  'has its keys out of order': () => Buffer.from(`d4:infod4:name1:a6:lengthi1e12:piece lengthi1e6:pieces20:${'x'.repeat(20)}ee`),
  'repeats a key': () => Buffer.from(`d4:infod6:lengthi1e6:lengthi1e4:name1:a12:piece lengthi1e6:pieces20:${'x'.repeat(20)}ee`),
  'pads a number with zeros': () => Buffer.from(`d4:infod6:lengthi01e4:name1:a12:piece lengthi1e6:pieces20:${'x'.repeat(20)}ee`),
  'writes zero as minus zero': () => Buffer.from('d4:infod6:lengthi-0e4:name1:a12:piece lengthi1e6:pieces0:ee'),
  'pads a string length with zeros': () => Buffer.from(`d4:infod6:lengthi1e4:name01:a12:piece lengthi1e6:pieces20:${'x'.repeat(20)}ee`),
  'claims a string longer than the file': () => Buffer.from('d4:infod6:lengthi1e4:name900:a'),
  'holds a number too large to count with': () => withInfo({ ...INFO, 'zz extra': 9_007_199_254_740_992 }),
  'has no info dictionary': () => bencode({ announce: 'https://tracker.example/announce' }),
  'has a list for its info': () => withInfo([INFO]),
  'has no name': () => withInfo(without('name')),
  'has a number for its name': () => withInfo({ ...INFO, name: 7 }),
  'has neither a length nor files': () => withInfo(without('length')),
  'has both a length and files': () => withInfo({ ...INFO, files: [{ length: 40_000, path: ['a'] }] }),
  'has a negative length': () => withInfo({ ...INFO, length: -1 }),
  'has text for its length': () => withInfo({ ...INFO, length: '40000' }),
  'has an empty file list': () => withInfo({ ...without('length'), files: [] }),
  'has text for its file list': () => withInfo({ ...without('length'), files: 'a.txt' }),
  'lists a file that is not a dictionary': () => withFile(['a.txt']),
  'lists a file with no path': () => withFile({ length: 1, path: [] }),
  'has no piece hashes': () => withInfo(without('pieces')),
  'has the wrong number of piece hashes': () => withInfo({ ...INFO, pieces: pieces(2) }),
  'has a piece length of zero': () => withInfo({ ...INFO, 'piece length': 0 }),
  'has sizes that overflow when added': () =>
    withInfo({ files: [{ length: Number.MAX_SAFE_INTEGER, path: ['a'] }, { length: Number.MAX_SAFE_INTEGER, path: ['b'] }], name: 'folder', 'piece length': 16_384, pieces: pieces(1) }),
  'has a number for its tracker': () => withInfo(INFO, { announce: 7 }),
  'has text for its tracker list': () => withInfo(INFO, { 'announce-list': 'https://tracker.example/announce' }),
  'is named ".."': () => withInfo({ ...INFO, name: '..' }),
  'is named with a slash': () => withInfo({ ...INFO, name: 'music/night-mix.flac' }),
  'has an empty name': () => withInfo({ ...INFO, name: '' }),
  'lists a file under ".."': () => withFile({ length: 1, path: ['..', 'outside.txt'] }),
  'lists a file under "."': () => withFile({ length: 1, path: ['.', 'here.txt'] }),
  'lists a file with an absolute path': () => withFile({ length: 1, path: ['/etc', 'passwd'] }),
  'lists a file with a backslash path': () => withFile({ length: 1, path: ['..\\outside.txt'] }),
  'lists a file on a drive letter': () => withFile({ length: 1, path: ['C:', 'outside.txt'] }),
  'lists a file with an empty path part': () => withFile({ length: 1, path: ['', 'etc', 'passwd'] }),
  'lists a file with a NUL in its name': () => withFile({ length: 1, path: ['a\0.txt'] }),
  'names no tracker': () => withInfo(INFO),
  'is a v1 and v2 hybrid': () => withInfo({ ...INFO, 'file tree': { 'night-mix.flac': { '': { length: 40_000, 'pieces root': Buffer.alloc(32, 1) } } }, 'meta version': 2 }),
  'is v2 only': () => withInfo({ ...without('pieces'), 'file tree': { 'night-mix.flac': { '': { length: 40_000, 'pieces root': Buffer.alloc(32, 1) } } }, 'meta version': 2 }),
};

Given('a torrent file holding one {int} byte file {string}', (world: object, _size: number, name: string) => {
  stateOf(world).bytes = singleFileTorrent(name);
});

Given('a torrent file holding the private folder {string}', (world: object, name: string) => {
  stateOf(world).bytes = folderTorrent(name);
});

Given(/^a torrent file that (.+)$/, (world: object, defect: string) => {
  const make = DEFECTS[defect];
  if (!make) throw new Error(`no torrent file that ${defect}`);
  stateOf(world).bytes = make();
});

When('the torrent file is read', async (world: object) => {
  const state = stateOf(world);
  try {
    state.metainfo = await readTorrentMetainfo(state.bytes as Uint8Array);
  } catch (error) {
    state.error = error;
  }
});

Then('the torrent metainfo info hash is the SHA-1 of the info dictionary as it sits in the file', (world: object) => {
  const state = stateOf(world);
  expect(state.error).toBeUndefined();
  expect(state.metainfo?.infoHash).toBe(decodeTorrent(state.bytes as Uint8Array)?.infoHash);
  expect(state.metainfo?.infoHash).toMatch(/^[0-9a-f]{40}$/);
});

Then('the torrent metainfo name is {string}', (world: object, name: string) => {
  expect(stateOf(world).metainfo?.name).toBe(name);
});

Then(/^the torrent metainfo is (not private|private)$/, (world: object, which: string) => {
  expect(stateOf(world).metainfo?.private).toBe(which === 'private');
});

Then('the torrent metainfo totals {int} bytes', (world: object, total: number) => {
  expect(stateOf(world).metainfo?.totalBytes).toBe(total);
});

Then('the torrent metainfo lists the files:', (world: object, table: DataTable) => {
  expect(stateOf(world).metainfo?.files).toEqual(table.hashes().map((row) => ({ path: row.path, size: Number(row.size) })));
});

Then('the torrent metainfo lists the trackers {string}', (world: object, trackers: string) => {
  expect(stateOf(world).metainfo?.trackers).toEqual(trackers.split(', ').filter(Boolean));
});

Then('reading the torrent file fails with {string}', (world: object, reason: string) => {
  expect(stateOf(world).metainfo).toBeUndefined();
  expectReason(stateOf(world).error, reason);
});

Then('the torrent file refusal is exactly {string}', (world: object, reason: string) => {
  expect(reasonOf(stateOf(world).error)).toBe(reason);
});

When('the info hash of the magnet link {string} is read', (world: object, magnet: string) => {
  const state = stateOf(world);
  try {
    state.hash = magnetInfoHash(magnet);
  } catch (error) {
    state.error = error;
  }
});

Then('the magnet link info hash is {string}', (world: object, hash: string) => {
  expect(stateOf(world).error).toBeUndefined();
  expect(stateOf(world).hash).toBe(hash);
});

Then('reading the magnet link fails with {string}', (world: object, reason: string) => {
  expect(stateOf(world).hash).toBeUndefined();
  expect(reasonOf(stateOf(world).error)).toBe(reason);
});
