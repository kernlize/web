import { lastValueFrom, takeUntil, timer, toArray } from 'rxjs';
import { decodeEventPointer, verifyEvent } from 'applesauce-core/helpers';
import { computeCvmToolSchemaHash, type CvmRegistryFamily } from '@kehto/services';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import { asFilters, type ApplesaucePool } from '@kernlize/kernel';

const KIND_SERVER = 11_316;
const KIND_TOOLS = 11_317;
const KIND_RELAY_LIST = 10_002;
const HASH = /^[0-9a-f]{64}$/u;
const MAX_BYTES = 1_000_000;
const MAX_TOOLS = 64;
/**
 * How long a search waits for the servers it asked, in milliseconds.
 *
 * @example
 * ```ts
 * discoverToolFamilies(input, { pool, relays, fetch, timeoutMs: TOOL_DISCOVERY_TIMEOUT_MS / 3 });
 * ```
 */
export const TOOL_DISCOVERY_TIMEOUT_MS = 15_000;

/** A family found for the person to review: the provider, its verified tools, and where it came from. */
export interface ToolFamilyCandidate {
  readonly family: CvmRegistryFamily;
  /** The announcement the inventory was read from. */
  readonly eventId: string;
  /** What the person typed, then the event. */
  readonly source: string;
}

/** What a search needs. */
export interface ToolDiscoveryOptions {
  readonly pool: Pick<ApplesaucePool, 'request'>;
  /** Asked when the reference names none. */
  readonly relays: readonly string[];
  /** Reads a website's published address. */
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}

type Reference = { readonly type: 'hash'; readonly hash: string } | { readonly type: 'website'; readonly url: string }
  | { readonly type: 'event'; readonly id: string; readonly author?: string; readonly relays: readonly string[] };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function parse(input: string): Reference {
  const typed = input.trim().replace(/^nostr:/iu, '');
  if (HASH.test(typed.toLowerCase())) return { type: 'hash', hash: typed.toLowerCase() };
  if (/^nevent1/iu.test(typed)) {
    const pointer = decodeEventPointer(typed);
    if (!pointer || (pointer.kind !== undefined && pointer.kind !== KIND_SERVER && pointer.kind !== KIND_TOOLS)) throw new Error('invalid:tool-reference');
    // An nevent always decodes with its relay list, empty when it names none.
    return { type: 'event', id: pointer.id, ...(pointer.author ? { author: pointer.author } : {}), relays: pointer.relays as string[] };
  }
  let url: URL;
  try {
    url = new URL(typed.includes('://') ? typed : `https://${typed}`);
  } catch {
    throw new Error('invalid:tool-reference');
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) throw new Error('invalid:tool-reference');
  return { type: 'website', url: `${url.origin}/.well-known/napplet.json` };
}

async function query(options: ToolDiscoveryOptions, relays: readonly string[], filter: NostrFilter): Promise<NostrEvent[]> {
  const limit = options.timeoutMs ?? TOOL_DISCOVERY_TIMEOUT_MS;
  const events = await lastValueFrom(options.pool.request([...relays], asFilters([{ ...filter, limit: MAX_TOOLS }])).pipe(takeUntil(timer(limit)), toArray()));
  return (events as NostrEvent[])
    .filter((event) => event.content.length <= MAX_BYTES && verifyEvent(event))
    .sort((a, b) => b.created_at - a.created_at);
}

/** A website's provider, from the `backend` of its `/.well-known/napplet.json`, read without credentials and at most 1 MB. */
async function websiteProvider(url: string, options: ToolDiscoveryOptions): Promise<{ pubkey: string; relays: string[] }> {
  const response = await options.fetch(url, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }).catch(() => undefined);
  const body = response?.ok ? await response.text() : '';
  const document = body.length <= MAX_BYTES ? parseJson(body) : undefined;
  const backend = record(document) && document.version === 1 ? document.backend : undefined;
  if (!record(backend) || typeof backend.pubkey !== 'string' || !HASH.test(backend.pubkey) || !Array.isArray(backend.relays)) throw new Error('unavailable:website');
  return { pubkey: backend.pubkey, relays: backend.relays.filter((relay): relay is string => typeof relay === 'string') };
}

/** The tools an announcement lists, each with its hash recomputed; a hash it states that differs is a refusal. */
async function inventory(event: NostrEvent): Promise<CvmRegistryFamily['tools']> {
  const payload = parseJson(event.content);
  const listed = record(payload) && Array.isArray(payload.tools) ? payload.tools : [];
  if (listed.length === 0 || listed.length > MAX_TOOLS) throw new Error('invalid:tool-inventory');
  const tools: Array<{ name: string; schemaHash: string }> = [];
  for (const raw of listed as unknown[]) {
    if (!record(raw) || typeof raw.name !== 'string' || !raw.name || !record(raw.inputSchema) || tools.some((tool) => tool.name === raw.name)) throw new Error('invalid:tool-inventory');
    const schemaHash = await computeCvmToolSchemaHash({ name: raw.name, inputSchema: raw.inputSchema, ...(record(raw.outputSchema) ? { outputSchema: raw.outputSchema } : {}) });
    const tagged = event.tags.filter((tag) => tag[0] === 'i' && tag[2] === raw.name);
    if (tagged.some((tag) => tag[1] !== schemaHash)) throw new Error('invalid:tool-inventory');
    tools.push({ name: raw.name, schemaHash });
  }
  return tools;
}

/** Where a provider takes requests: its relay list's unmarked servers, else all of them, else where it was found. */
function providerRelays(lists: readonly NostrEvent[], pubkey: string, found: readonly string[]): string[] {
  const listed = lists.find((list) => list.pubkey === pubkey)?.tags.filter((tag) => tag[0] === 'r' && typeof tag[1] === 'string') ?? [];
  const unmarked = listed.filter((tag) => !tag[2]);
  const chosen = (unmarked.length > 0 ? unmarked : listed).map((tag) => tag[1] as string);
  return chosen.length > 0 ? chosen : [...found];
}

async function announcements(reference: Reference, options: ToolDiscoveryOptions): Promise<{ events: NostrEvent[]; relays: readonly string[] }> {
  if (reference.type === 'website') {
    const provider = await websiteProvider(reference.url, options);
    return { events: await query(options, provider.relays, { kinds: [KIND_TOOLS], authors: [provider.pubkey] }), relays: provider.relays };
  }
  const relays = reference.type === 'event' && reference.relays.length > 0 ? reference.relays : options.relays;
  if (reference.type === 'hash') return { events: await query(options, relays, { kinds: [KIND_TOOLS], '#i': [reference.hash] } as NostrFilter), relays };
  const found = await query(options, relays, { ids: [reference.id], kinds: [KIND_SERVER, KIND_TOOLS], ...(reference.author ? { authors: [reference.author] } : {}) });
  const first = found[0];
  if (first?.kind === KIND_SERVER) return { events: await query(options, relays, { kinds: [KIND_TOOLS], authors: [first.pubkey] }), relays };
  return { events: found, relays };
}

/**
 * Find tool families from what the person typed: a reference to a server's or
 * a tool list's announcement, a tool's schema hash, or a website that
 * publishes its provider. Only signed announcements are read; every tool's
 * hash is computed again from its schema, and an announcement whose stated
 * hash differs is refused. The newest inventory of each provider is the one
 * read, never an older one in its place (D-043).
 *
 * @param input - What the person typed.
 * @param options - Pool, default relays, and the website fetcher.
 * @returns One candidate per provider, for the person to name and save.
 * @throws `invalid:tool-reference`, `unavailable:website`, `invalid:tool-inventory`, or `unavailable:no-tools`.
 * @example
 * ```ts
 * const [candidate] = await discoverToolFamilies('nevent1…', { pool, relays: tiers.get().super });
 * settings.saveFamily({ ...candidate.family, family: 'rooms' });
 * ```
 */
export async function discoverToolFamilies(input: string, options: ToolDiscoveryOptions): Promise<ToolFamilyCandidate[]> {
  const reference = parse(input);
  const { events, relays } = await announcements(reference, options);
  const newest = new Map<string, NostrEvent>();
  for (const event of events) if (event.kind === KIND_TOOLS && !newest.has(event.pubkey)) newest.set(event.pubkey, event);
  if (newest.size === 0) throw new Error('unavailable:no-tools');
  const lists = reference.type === 'website' ? [] : await query(options, relays, { kinds: [KIND_RELAY_LIST], authors: [...newest.keys()] });
  const candidates: ToolFamilyCandidate[] = [];
  for (const event of newest.values()) {
    const tools = await inventory(event);
    if (reference.type === 'hash' && !tools.some((tool) => tool.schemaHash === reference.hash)) continue;
    candidates.push({
      family: { family: `tools.${event.pubkey.slice(0, 12)}`, server: { pubkey: event.pubkey, relays: providerRelays(lists, event.pubkey, relays) }, tools },
      eventId: event.id,
      source: `${input.trim()} · ${event.id.slice(0, 12)}`,
    });
  }
  if (candidates.length === 0) throw new Error('unavailable:no-tools');
  return candidates;
}
