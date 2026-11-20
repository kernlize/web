import { checkClientEndpoint, type PageScheme } from '@kernlize/bridges';
import type { DownloadClientsState, DownloadConnection, DownloadDomain, DownloadProgram, RoutedDomain } from './connections.js';

/** What a program is for, and what it asks for before it answers. */
export interface DownloadProgramInfo {
  /** The NAP domain the program serves. */
  readonly domain: DownloadDomain;
  /** The program's own name, as its makers write it. */
  readonly name: string;
  /** Which sign-in fields the program takes. */
  readonly signIn: readonly ('username' | 'password' | 'apiKey')[];
  /** An address the program answers at when it runs on this device with its usual settings. */
  readonly example: string;
}

/**
 * Every program kernl can drive, with the domain it serves and the sign-in it takes.
 *
 * @example
 * ```ts
 * DOWNLOAD_PROGRAMS.sabnzbd.signIn; // ['apiKey']
 * DOWNLOAD_PROGRAMS.transmission.domain; // 'torrent'
 * ```
 */
export const DOWNLOAD_PROGRAMS: Readonly<Record<DownloadProgram, DownloadProgramInfo>> = Object.freeze({
  transmission: { domain: 'torrent', name: 'Transmission', signIn: ['username', 'password'], example: 'http://localhost:9091' },
  utorrent: { domain: 'torrent', name: 'uTorrent', signIn: ['username', 'password'], example: 'http://localhost:8080' },
  nzbget: { domain: 'nzb', name: 'NZBGet', signIn: ['username', 'password'], example: 'http://localhost:6789' },
  sabnzbd: { domain: 'nzb', name: 'SABnzbd', signIn: ['apiKey'], example: 'http://localhost:8080' },
  slskd: { domain: 'soulseek', name: 'slskd', signIn: ['apiKey', 'username', 'password'], example: 'http://localhost:5030' },
});

const MAX_TEXT_LENGTH = 512;
const MAX_LABEL_LENGTH = 60;
const ROUTED: readonly RoutedDomain[] = ['torrent', 'soulseek'];
const ID = /^[A-Za-z0-9-]{1,64}$/;
const GENERATION = /^\d{1,9}$/;

type Defaults = Partial<Record<RoutedDomain, string>>;

/** Whether a sign-in field is absent or text of a sane length. */
export const isSignInText = (value: unknown): value is string | undefined => value === undefined || (typeof value === 'string' && value.length <= MAX_TEXT_LENGTH);

/** The domain a program serves. */
export const domainOf = (program: DownloadProgram): DownloadDomain => DOWNLOAD_PROGRAMS[program].domain;

/** A label the person typed, trimmed; a thrown `invalid:label` unless it is 1 to 60 characters. */
export function labelFrom(value: string): string {
  const label = value.trim();
  if (label.length < 1 || label.length > MAX_LABEL_LENGTH) throw new Error('invalid:label');
  return label;
}

/** The program's name, numbered from 2 while another connection already goes by it. */
export function defaultLabel(program: DownloadProgram, connections: readonly DownloadConnection[]): string {
  const name = DOWNLOAD_PROGRAMS[program].name;
  const taken = new Set(connections.map((connection) => connection.label));
  let label = name;
  for (let n = 2; taken.has(label); n += 1) label = `${name} ${n}`;
  return label;
}

/** The routing key for a connection whose address just changed: the same id, the next generation. */
export function nextRoutingKey(connection: DownloadConnection): string {
  return `${connection.id}:${Number(connection.routingKey.slice(connection.id.length + 1)) + 1}`;
}

/**
 * The state with every routed domain's default naming one of its connections: the one wanted
 * when it is there, else the first of the domain in added order; none when the domain has none.
 */
export function withDefaults(connections: readonly DownloadConnection[], wanted: Readonly<Record<string, unknown>>, locked: readonly string[]): DownloadClientsState {
  const defaults: Defaults = {};
  for (const domain of ROUTED) {
    const serving = connections.filter((connection) => domainOf(connection.program) === domain);
    const chosen = serving.find((connection) => connection.id === wanted[domain]) ?? serving[0];
    if (chosen) defaults[domain] = chosen.id;
  }
  return { connections, defaults, locked };
}

/** The connection of the same domain added after the one removed, else the first other one; the next default. */
export function successor(connections: readonly DownloadConnection[], removed: DownloadConnection): DownloadConnection | undefined {
  const domain = domainOf(removed.program);
  const serving = connections.filter((connection) => domainOf(connection.program) === domain);
  return serving[serving.indexOf(removed) + 1] ?? serving.find((connection) => connection !== removed);
}

const isProgram = (value: unknown): value is DownloadProgram => typeof value === 'string' && Object.hasOwn(DOWNLOAD_PROGRAMS, value);

function isLabel(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= MAX_LABEL_LENGTH;
}

/** What was stored, when it is still a connection this page may use; undefined otherwise, so nothing stored is trusted as it stands. */
function usable(value: unknown, page: PageScheme): DownloadConnection | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { id, program, label, url, username, routingKey, hasPassword, hasApiKey } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !ID.test(id) || !isProgram(program) || !isLabel(label) || !isSignInText(username)) return undefined;
  if (typeof routingKey !== 'string' || !routingKey.startsWith(`${id}:`) || !GENERATION.test(routingKey.slice(id.length + 1))) return undefined;
  const checked = typeof url === 'string' ? checkClientEndpoint(url, page) : undefined;
  if (!checked?.ok) return undefined;
  return { id, program, label, url: checked.url, ...(username ? { username } : {}), hasPassword: hasPassword === true, hasApiKey: hasApiKey === true, routingKey };
}

/**
 * The settings as stored, read as untrusted: a damaged entry, an unknown program, an address
 * this page may not call or a second entry under an id already read is dropped, and a default
 * that names no connection of its domain is replaced by the first that is.
 */
export function readStoredState(value: unknown, page: PageScheme): DownloadClientsState {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as { connections?: unknown; defaults?: unknown };
  const connections: DownloadConnection[] = [];
  for (const entry of Array.isArray(stored.connections) ? stored.connections : []) {
    const connection = usable(entry, page);
    if (connection && !connections.some((kept) => kept.id === connection.id)) connections.push(connection);
  }
  const wanted = typeof stored.defaults === 'object' && stored.defaults !== null ? (stored.defaults as Record<string, unknown>) : {};
  return withDefaults(connections, wanted, []);
}
