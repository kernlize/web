import { clientError } from './http';
import type { TorrentMetainfo } from './types';

/** Far above any real `.torrent`; a larger file is refused before it is walked. */
const MAX_METAINFO_BYTES = 32 * 1024 * 1024;
/** A v1 torrent nests four deep; the bound keeps a hostile file from exhausting the stack. */
const MAX_DEPTH = 32;
const SHA1_BYTES = 20;

/** A dictionary with the byte span it occupied, which is what an info hash is taken over. */
class BencodeDictionary {
  constructor(
    readonly entries: ReadonlyMap<string, BencodeValue>,
    readonly start: number,
    readonly end: number,
  ) {}
}

type BencodeValue = number | Uint8Array | readonly BencodeValue[] | BencodeDictionary;

interface Cursor {
  readonly bytes: Uint8Array;
  position: number;
}

function malformed(): Error {
  return clientError('invalid:metainfo');
}

/** One character per byte, so that comparing two keys compares their raw bytes as BEP 3 orders them. */
function binaryText(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** Reads the digits a canonical integer or length is made of: no sign on zero, no leading zeros. */
function readNumber(cursor: Cursor, pattern: RegExp): number {
  const match = pattern.exec(binaryText(cursor.bytes.subarray(cursor.position, cursor.position + 24)));
  const value = Number(match?.[1]);
  if (!Number.isSafeInteger(value)) throw malformed();
  cursor.position += (match as RegExpExecArray)[0].length;
  return value;
}

function readBytes(cursor: Cursor): Uint8Array {
  const length = readNumber(cursor, /^(0|[1-9]\d*):/);
  const end = cursor.position + length;
  if (end > cursor.bytes.length) throw malformed();
  const value = cursor.bytes.subarray(cursor.position, end);
  cursor.position = end;
  return value;
}

function atEnd(cursor: Cursor): boolean {
  if (cursor.bytes[cursor.position] !== 0x65) return false;
  cursor.position += 1;
  return true;
}

function readList(cursor: Cursor, depth: number): readonly BencodeValue[] {
  cursor.position += 1;
  const items: BencodeValue[] = [];
  while (!atEnd(cursor)) items.push(readValue(cursor, depth + 1));
  return items;
}

/**
 * Keys must be strictly ascending. A dictionary with a repeated or misplaced key is read
 * differently by different programs, so its info hash would not name one torrent.
 */
function readDictionary(cursor: Cursor, depth: number): BencodeDictionary {
  const start = cursor.position;
  cursor.position += 1;
  const entries = new Map<string, BencodeValue>();
  let previous: string | undefined;
  while (!atEnd(cursor)) {
    const key = binaryText(readBytes(cursor));
    if (previous !== undefined && key <= previous) throw malformed();
    previous = key;
    entries.set(key, readValue(cursor, depth + 1));
  }
  return new BencodeDictionary(entries, start, cursor.position);
}

function readValue(cursor: Cursor, depth: number): BencodeValue {
  if (depth > MAX_DEPTH) throw malformed();
  const lead = cursor.bytes[cursor.position];
  if (lead === 0x64) return readDictionary(cursor, depth);
  if (lead === 0x6c) return readList(cursor, depth);
  if (lead === 0x69) return readNumber(cursor, /^i(0|-?[1-9]\d*)e/);
  return readBytes(cursor);
}

function asDictionary(value: BencodeValue | undefined): BencodeDictionary {
  if (!(value instanceof BencodeDictionary)) throw malformed();
  return value;
}

function asList(value: BencodeValue | undefined): readonly BencodeValue[] {
  if (!Array.isArray(value)) throw malformed();
  return value as readonly BencodeValue[];
}

function asBytes(value: BencodeValue | undefined): Uint8Array {
  if (!(value instanceof Uint8Array)) throw malformed();
  return value;
}

function asSize(value: BencodeValue | undefined): number {
  if (typeof value !== 'number' || value < 0) throw malformed();
  return value;
}

function asText(value: BencodeValue | undefined): string {
  return new TextDecoder().decode(asBytes(value));
}

/**
 * One name on the way to a file. Anything that could step outside the torrent's own
 * folder when a client joins the parts is refused: empty, `.`, `..`, a drive letter, or a
 * name holding a separator or a NUL.
 */
function asPathPart(value: BencodeValue | undefined): string {
  const part = asText(value);
  if (/^$|^\.\.?$|^[a-z]:$|[\\/\0]/i.test(part)) throw malformed();
  return part;
}

function fileEntry(value: BencodeValue): TorrentMetainfo['files'][number] {
  const { entries } = asDictionary(value);
  const parts = asList(entries.get('path')).map(asPathPart);
  if (parts.length === 0) throw malformed();
  return { path: parts.join('/'), size: asSize(entries.get('length')) };
}

function filesOf(info: BencodeDictionary['entries'], name: string): TorrentMetainfo['files'] {
  const list = info.get('files');
  const length = info.get('length');
  if ((list === undefined) === (length === undefined)) throw malformed();
  if (list === undefined) return [{ path: name, size: asSize(length) }];
  const files = asList(list).map(fileEntry);
  if (files.length === 0) throw malformed();
  return files;
}

function trackersOf(root: BencodeDictionary['entries']): readonly string[] {
  const announce = root.get('announce');
  const tiers = root.get('announce-list');
  const single = announce === undefined ? [] : [asText(announce)];
  const listed = tiers === undefined ? [] : asList(tiers).flatMap((tier) => asList(tier).map(asText));
  return [...new Set([...single, ...listed])].filter(Boolean);
}

/**
 * A torrent kernl can name has v1 piece hashes. A BitTorrent v2 torrent without them
 * (BEP 52) has no SHA-1 info hash that a v1 client would know it by.
 */
function requireV1Pieces(info: BencodeDictionary['entries'], totalBytes: number): void {
  const pieces = info.get('pieces');
  if (pieces === undefined && info.has('meta version')) throw clientError('invalid:metainfo-format', 'the torrent has no v1 piece hashes');
  const pieceLength = asSize(info.get('piece length'));
  if (!Number.isSafeInteger(totalBytes) || pieceLength === 0) throw malformed();
  if (asBytes(pieces).length !== Math.ceil(totalBytes / pieceLength) * SHA1_BYTES) throw malformed();
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Reads a `.torrent` file strictly enough to trust its info hash: canonical bencode only
 * (sorted, unrepeated keys, no padded numbers, nothing after the root), the v1 fields
 * every client needs, and file paths that stay inside the torrent. The hash is the SHA-1
 * of the `info` dictionary's own bytes as they appear in the file, never of a re-encoding.
 *
 * @param bytes - The whole file.
 * @returns The info hash, name, privacy flag, files and trackers.
 * @throws `invalid:metainfo` for anything malformed or unsafe, `invalid:metainfo-format`
 * for a BitTorrent v2 torrent that carries no v1 piece hashes.
 * @example
 * ```ts
 * const { infoHash, files } = await readTorrentMetainfo(new Uint8Array(await file.arrayBuffer()));
 * ```
 */
export async function readTorrentMetainfo(bytes: Uint8Array): Promise<TorrentMetainfo> {
  if (bytes.length > MAX_METAINFO_BYTES) throw malformed();
  const cursor: Cursor = { bytes, position: 0 };
  const root = asDictionary(readValue(cursor, 0));
  if (cursor.position !== bytes.length) throw malformed();
  const info = asDictionary(root.entries.get('info'));
  const name = asPathPart(info.entries.get('name'));
  const files = filesOf(info.entries, name);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  requireV1Pieces(info.entries, totalBytes);
  const digest = await crypto.subtle.digest('SHA-1', bytes.slice(info.start, info.end));
  return {
    infoHash: hex(new Uint8Array(digest)),
    name,
    private: info.entries.get('private') === 1,
    totalBytes,
    files,
    trackers: trackersOf(root.entries),
  };
}

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32ToHex(text: string): string {
  let bits = '';
  for (const letter of text) bits += BASE32.indexOf(letter).toString(2).padStart(5, '0');
  return bits.replace(/[01]{4}/g, (nibble) => Number.parseInt(nibble, 2).toString(16));
}

/**
 * The v1 info hash a magnet link names, from its first `xt=urn:btih:` topic. BEP 9
 * allows the hash as 40 hexadecimal or 32 base32 characters; both come back as hex.
 *
 * @param magnet - A `magnet:?…` link.
 * @returns The info hash as 40 lowercase hexadecimal characters.
 * @throws `invalid:magnet` when the link is not a magnet or names no v1 info hash.
 * @example
 * ```ts
 * magnetInfoHash('magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Night%20Mix');
 * // 'abcdef0123456789abcdef0123456789abcdef01'
 * ```
 */
export function magnetInfoHash(magnet: string): string {
  const query = /^magnet:\?(.*)$/is.exec(magnet)?.[1] ?? '';
  const topics = new URLSearchParams(query).getAll('xt').map((topic) => topic.toLowerCase());
  const hash = topics.find((topic) => topic.startsWith('urn:btih:'))?.slice('urn:btih:'.length) ?? '';
  if (/^[0-9a-f]{40}$/.test(hash)) return hash;
  if (/^[a-z2-7]{32}$/.test(hash)) return base32ToHex(hash);
  throw clientError('invalid:magnet');
}
