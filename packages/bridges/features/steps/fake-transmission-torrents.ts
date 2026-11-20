import { createHash } from 'node:crypto';

/**
 * Torrent files for the scenarios, and a second, independent reading of them.
 *
 * The encoder and the span finder here share no code with `torrent-metainfo.ts`, so an
 * info hash both agree on has been worked out twice. A real Transmission 4.1.4 was given
 * files from this encoder and named them by the same hashes.
 */

export type Bencodable = number | string | Uint8Array | readonly Bencodable[] | { readonly [key: string]: Bencodable };

export function bencode(value: Bencodable): Buffer {
  if (typeof value === 'number') return Buffer.from(`i${value}e`);
  if (typeof value === 'string') return bencode(Buffer.from(value));
  if (value instanceof Uint8Array) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from('l'), ...(value as readonly Bencodable[]).map(bencode), Buffer.from('e')]);
  const entries = Object.entries(value as { readonly [key: string]: Bencodable }).sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  return Buffer.concat([Buffer.from('d'), ...entries.flatMap(([key, item]) => [bencode(key), bencode(item)]), Buffer.from('e')]);
}

type Decoded = number | Buffer | Decoded[] | Map<string, Decoded>;

interface Span {
  readonly value: Decoded;
  readonly end: number;
  /** Where the value under the root's `info` key began and ended, when this is the root dictionary. */
  readonly info?: readonly [number, number];
}

function decodeAt(bytes: Buffer, at: number): Span {
  const lead = String.fromCharCode(bytes[at] ?? 0);
  if (lead === 'i') {
    const end = bytes.indexOf('e', at);
    return { value: Number(bytes.toString('latin1', at + 1, end)), end: end + 1 };
  }
  if (lead === 'l' || lead === 'd') {
    const items: Decoded[] = [];
    const starts: number[] = [];
    let cursor = at + 1;
    while (bytes[cursor] !== 0x65) {
      if (cursor >= bytes.length) throw new Error('unterminated');
      const item = decodeAt(bytes, cursor);
      starts.push(cursor);
      items.push(item.value);
      cursor = item.end;
    }
    if (lead === 'l') return { value: items, end: cursor + 1 };
    const map = new Map<string, Decoded>();
    let info: [number, number] | undefined;
    for (let index = 0; index + 1 < items.length; index += 2) {
      const key = (items[index] as Buffer).toString('latin1');
      map.set(key, items[index + 1] as Decoded);
      if (key === 'info') info = [starts[index + 1] as number, starts[index + 2] ?? cursor];
    }
    return { value: map, end: cursor + 1, ...(info ? { info } : {}) };
  }
  const colon = bytes.indexOf(':', at);
  const length = Number(bytes.toString('latin1', at, colon));
  if (colon < 0 || !Number.isInteger(length) || colon + 1 + length > bytes.length) throw new Error('not a string');
  return { value: bytes.subarray(colon + 1, colon + 1 + length), end: colon + 1 + length };
}

export interface DecodedTorrent {
  readonly infoHash: string;
  readonly name: string;
  readonly private: boolean;
  /** Paths inside the torrent, without the torrent's own folder. */
  readonly files: readonly { readonly path: string; readonly length: number }[];
}

/** What a torrent client makes of a `.torrent` file, or undefined when it would not take it. */
export function decodeTorrent(bytes: Uint8Array): DecodedTorrent | undefined {
  try {
    const buffer = Buffer.from(bytes);
    const root = decodeAt(buffer, 0);
    const info = (root.value as Map<string, Decoded>).get('info') as Map<string, Decoded>;
    if (!root.info || !(info instanceof Map)) return undefined;
    const name = (info.get('name') as Buffer).toString();
    const listed = info.get('files') as Map<string, Decoded>[] | undefined;
    const files = listed
      ? listed.map((file) => ({ path: (file.get('path') as Buffer[]).map(String).join('/'), length: file.get('length') as number }))
      : [{ path: name, length: info.get('length') as number }];
    return { infoHash: createHash('sha1').update(buffer.subarray(root.info[0], root.info[1])).digest('hex'), name, private: info.get('private') === 1, files };
  } catch {
    return undefined;
  }
}

export function pieces(count: number): Buffer {
  return Buffer.alloc(count * 20, 7);
}

/** One 40 000 byte file, public, with one tracker named twice. */
export function singleFileTorrent(name = 'night-mix.flac'): Buffer {
  return bencode({
    announce: 'https://tracker.example/announce',
    'announce-list': [['https://tracker.example/announce'], ['udp://backup.example:6969', '']],
    'created by': 'kernl scenarios',
    info: { length: 40_000, name, 'piece length': 16_384, pieces: pieces(3) },
  });
}

/** A private folder of three files, 60 000 bytes together. */
export function folderTorrent(name = 'Field Recordings'): Buffer {
  return bencode({
    announce: 'https://private.example/announce',
    info: {
      files: [
        { length: 10_000, path: ['notes.txt'] },
        { length: 20_000, path: ['day one', 'dawn.flac'] },
        { length: 30_000, path: ['day two', 'dusk.flac'] },
      ],
      name,
      'piece length': 16_384,
      pieces: pieces(4),
      private: 1,
    },
  });
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The info hash a magnet link names, read the way a torrent client does, or undefined when it names none. */
export function magnetHash(magnet: string): string | undefined {
  const topic = /^magnet:\?(?:.*&)?xt=urn:btih:([0-9a-z]+)/i.exec(magnet)?.[1] ?? '';
  if (/^[0-9a-f]{40}$/i.test(topic)) return topic.toLowerCase();
  if (!/^[a-z2-7]{32}$/i.test(topic)) return undefined;
  let value = 0n;
  for (const letter of topic.toUpperCase()) value = value * 32n + BigInt(BASE32.indexOf(letter));
  return value.toString(16).padStart(40, '0');
}
