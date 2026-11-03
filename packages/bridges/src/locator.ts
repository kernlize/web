import { listField, optionalField, requireField } from './fields';
import type { Locator } from './types';

type Fields = Record<string, string | readonly string[]>;

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const WEB_SCHEMES = new Set(['http', 'https', 'ws', 'wss']);
const HEX_HASH = /^[0-9a-f]{40}$/i;
const BASE32_HASH = /^[a-z2-7]{32}$/i;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function invalid(reason = 'locator'): Error {
  return new Error(`invalid:${reason}`);
}

function decode(component: string): string {
  try {
    return decodeURIComponent(component);
  } catch {
    throw invalid();
  }
}

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw invalid();
  }
}

function base32ToHex(encoded: string): string {
  let bits = 0;
  let buffer = 0;
  let hex = '';
  for (const char of encoded.toUpperCase()) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      hex += ((buffer >> bits) & 0xff).toString(16).padStart(2, '0');
    }
  }
  return hex;
}

function infoHashFrom(topics: readonly string[]): string | undefined {
  for (const topic of topics) {
    const hash = topic.replace(/^urn:btih:/i, '');
    if (hash === topic) continue;
    if (HEX_HASH.test(hash)) return hash.toLowerCase();
    if (BASE32_HASH.test(hash)) return base32ToHex(hash);
  }
  return undefined;
}

function parseMagnet(uri: string): Fields {
  const query = uri.indexOf('?');
  const params = new URLSearchParams(query === -1 ? '' : uri.slice(query + 1));
  const infoHash = infoHashFrom(params.getAll('xt'));
  if (!infoHash) throw invalid('magnet-missing-hash');
  const fields: Fields = { infoHash, trackers: params.getAll('tr'), webSeeds: params.getAll('ws') };
  const name = params.get('dn');
  if (name) fields.name = name;
  return fields;
}

function lastSegment(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? '';
}

/**
 * Tells whether a web URL points at an NZB document, judged by its path.
 *
 * @param url - A URL string.
 * @returns True when the URL parses and its path ends in `.nzb`.
 * @example
 * ```ts
 * isNzbUrl('https://indexer.example/get/123.nzb'); // true
 * isNzbUrl('https://example.com/index.html'); // false
 * ```
 */
export function isNzbUrl(url: string): boolean {
  try {
    return /\.nzb$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function parseNzbTarget(target: string): Fields {
  const url = parseUrl(target);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw invalid();
  const name = url.searchParams.get('name') ?? decode(lastSegment(url.pathname));
  return { url: url.href, name };
}

function parseSoulseek(uri: string): Fields {
  const body = uri.slice('slsk://'.length);
  const slash = body.indexOf('/');
  const user = slash === -1 ? body : body.slice(0, slash);
  const path = slash === -1 ? '' : body.slice(slash + 1);
  if (!user || !path) throw invalid();
  return { user: decode(user), path: decode(path) };
}

function parseMailto(uri: string): Fields {
  const url = parseUrl(uri);
  const address = decode(url.pathname);
  const addresses = address
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (addresses.length === 0) throw invalid();
  const fields: Fields = { address, addresses };
  const subject = url.searchParams.get('subject');
  const body = url.searchParams.get('body');
  if (subject !== null) fields.subject = subject;
  if (body !== null) fields.body = body;
  return fields;
}

function parseWeb(uri: string): Fields {
  const url = parseUrl(uri);
  return { origin: url.origin, host: url.host, path: `${url.pathname}${url.search}` };
}

function fieldsFor(scheme: string, uri: string): { scheme: string; fields: Fields } {
  switch (scheme) {
    case 'magnet':
      return { scheme, fields: parseMagnet(uri) };
    case 'nzb':
      return { scheme, fields: parseNzbTarget(decode(uri.slice('nzb://'.length))) };
    case 'slsk':
      return { scheme, fields: parseSoulseek(uri) };
    case 'mailto':
      return { scheme, fields: parseMailto(uri) };
    default:
      if (!WEB_SCHEMES.has(scheme)) return { scheme, fields: {} };
      if (isNzbUrl(uri)) return { scheme: 'nzb', fields: parseNzbTarget(uri) };
      return { scheme, fields: parseWeb(uri) };
  }
}

/**
 * Parses a locator string into its scheme and scheme-specific fields.
 *
 * Magnet links yield `infoHash` (lowercase hex), `name`, `trackers` and `webSeeds`.
 * NZB locators (`nzb://` wrapping an encoded web URL, or a web URL ending in `.nzb`)
 * yield `url` and `name`. Soulseek locators yield `user` and `path`. Mail locators
 * yield `address`, `addresses`, `subject` and `body`. Web URLs yield `origin`, `host`
 * and `path`. Any other well-formed scheme yields no fields.
 *
 * @param uri - The locator string.
 * @returns The parsed locator.
 * @throws `invalid:locator` for strings that are not a locator, `invalid:magnet-missing-hash` for magnets without an info hash.
 * @example
 * ```ts
 * const locator = parseLocator('magnet:?xt=urn:btih:' + 'ab'.repeat(20) + '&dn=Film');
 * locator.scheme; // 'magnet'
 * locator.fields.name; // 'Film'
 * ```
 */
export function parseLocator(uri: string): Locator {
  const match = SCHEME.exec(uri);
  if (!match?.[1]) throw invalid();
  const { scheme, fields } = fieldsFor(match[1].toLowerCase(), uri);
  return { scheme, raw: uri, fields };
}

/**
 * Produces a short user-facing label for a locator: a name where one is known,
 * otherwise the host or peer. The label never includes the scheme.
 *
 * @param locator - A parsed locator.
 * @returns The label.
 * @example
 * ```ts
 * formatLocator(parseLocator('https://example.com/a/b')); // 'example.com'
 * formatLocator(parseLocator('mailto:ada@example.com')); // 'ada@example.com'
 * ```
 */
export function formatLocator(locator: Locator): string {
  switch (locator.scheme) {
    case 'magnet':
      return optionalField(locator, 'name') ?? requireField(locator, 'infoHash');
    case 'nzb':
      return requireField(locator, 'name');
    case 'slsk':
      return lastSegment(requireField(locator, 'path')) || requireField(locator, 'user');
    case 'mailto':
      return listField(locator, 'addresses').join(', ');
    default:
      return optionalField(locator, 'host') ?? locator.raw.replace(SCHEME, '').replace(/^\/+/, '');
  }
}
