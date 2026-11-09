const HEX_ID = /^[0-9a-f]{64}$/;
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const CHECKSUM_LENGTH = 6;
const ACCOUNT_PREFIX = 'npub';
const URI_SCHEME = 'nostr:';

export interface Bech32Payload {
  prefix: string;
  bytes: Uint8Array;
}

function polymod(values: readonly number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    BECH32_GENERATORS.forEach((generator, bit) => {
      if ((top >>> bit) & 1) checksum ^= generator;
    });
  }
  return checksum >>> 0;
}

function expandPrefix(prefix: string): number[] {
  const codes = [...prefix].map((character) => character.charCodeAt(0));
  return [...codes.map((code) => code >>> 5), 0, ...codes.map((code) => code & 31)];
}

function regroupToBytes(words: readonly number[]): Uint8Array | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const word of words) {
    buffer = (buffer << 5) | word;
    bits += 5;
    if (bits < 8) continue;
    bits -= 8;
    bytes.push((buffer >>> bits) & 0xff);
  }
  const padding = buffer & ((1 << bits) - 1);
  return bits >= 5 || padding !== 0 ? null : Uint8Array.from(bytes);
}

/** Decode a checksummed bech32 string; null for anything malformed. */
export function decodeBech32(text: string): Bech32Payload | null {
  const lower = text.toLowerCase();
  if (text !== lower && text !== text.toUpperCase()) return null;
  const split = lower.lastIndexOf('1');
  if (split < 1 || lower.length - split - 1 < CHECKSUM_LENGTH) return null;
  const prefix = lower.slice(0, split);
  const words = Array.from(lower.slice(split + 1), (character) => BECH32_CHARSET.indexOf(character));
  if (words.includes(-1)) return null;
  if (polymod([...expandPrefix(prefix), ...words]) !== 1) return null;
  const bytes = regroupToBytes(words.slice(0, -CHECKSUM_LENGTH));
  return bytes ? { prefix, bytes } : null;
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** True for the canonical form: 64 lowercase hex characters. */
export function isHexAccountId(value: string): boolean {
  return HEX_ID.test(value);
}

/** Read what a person typed or pasted into the canonical hex account id. */
export function parseAccountId(input: string): string | null {
  let text = input.trim();
  if (text.toLowerCase().startsWith(URI_SCHEME)) text = text.slice(URI_SCHEME.length);
  const lower = text.toLowerCase();
  if (isHexAccountId(lower)) return lower;
  const decoded = decodeBech32(text);
  if (!decoded || decoded.prefix !== ACCOUNT_PREFIX || decoded.bytes.length !== 32) return null;
  return toHex(decoded.bytes);
}

/** Shorten an account id for display: `abcd1234…wxyz`. */
export function shortAccountId(hex: string): string {
  return hex.length <= 13 ? hex : `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

/**
 * Read the account id out of a "open a conversation" request from another
 * applet. The payload is untrusted, so anything but an object carrying a
 * 64-hex `pubkey` is refused.
 */
export function parseOpenRequest(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidate = (payload as { pubkey?: unknown }).pubkey;
  if (typeof candidate !== 'string') return null;
  const lower = candidate.toLowerCase();
  return isHexAccountId(lower) ? lower : null;
}
