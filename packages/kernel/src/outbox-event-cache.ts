import { createRelayEventResultWithHints, type RelayEventResult } from '@kehto/runtime';
import type { OutboxRelayPlan, StreamingOutboxRouter } from '@kehto/services';
import { isEvent, matchFilter, verifyEvent, type NostrEvent } from 'applesauce-core/helpers';
import { asFilters } from './applesauce/relay-hooks.js';
import type { StorageLike } from './types.js';

const STORAGE_KEY = 'kernl:outbox-tree-events:v2';
const PUBLIC_TREE_KINDS = new Set([31971, 31969, 31108, 1111]);
const PUBLIC_TREE_RELAYS = new Set(['wss://nos.lol', 'wss://relay.routstr.com', 'wss://relay.redsh1ft.com']);
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_RECORDS = 256;
const MAX_STORAGE_CHARS = 256_000;
const MAX_EVENT_CHARS = 16_000;
const MAX_FILTERS = 32;
const MAX_FILTER_KEYS = 32;
const MAX_FILTER_VALUES = 256;
const MAX_REPLAY = 128;

type PlannedSubscribe = NonNullable<StreamingOutboxRouter['subscribeWithPlan']>;
type Filters = Parameters<PlannedSubscribe>[0];

interface Observation {
  readonly relay: string;
  readonly observed: number;
  readonly event: NostrEvent;
}

function publicRelay(url: string): string | undefined {
  const normalized = url.endsWith('/') ? url.slice(0, -1) : url;
  return PUBLIC_TREE_RELAYS.has(normalized) ? normalized : undefined;
}

function plannedRelays(plan: OutboxRelayPlan): Set<string> {
  return new Set(plan.relays.map(publicRelay).filter((url): url is string => url !== undefined));
}

function supportedFilter(filter: Filters[number]): boolean {
  const entries = Object.entries(filter);
  return entries.length <= MAX_FILTER_KEYS && entries.every(([key, value]) => {
    if (key === 'since' || key === 'until' || key === 'limit') return Number.isSafeInteger(value) && value >= 0;
    if (key === 'kinds') return Array.isArray(value) && value.length <= MAX_FILTER_VALUES && value.every(Number.isSafeInteger);
    if (key !== 'ids' && key !== 'authors' && !/^#[a-zA-Z]$/.test(key)) return false;
    return Array.isArray(value) && value.length > 0 && value.length <= MAX_FILTER_VALUES && value.every((part) => typeof part === 'string');
  });
}

function isObservation(value: unknown): value is Observation {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<Observation>;
  if (typeof row.relay !== 'string' || !publicRelay(row.relay)) return false;
  if (typeof row.observed !== 'number' || !Number.isSafeInteger(row.observed) || row.observed > Date.now() || row.observed <= Date.now() - MAX_AGE_MS) return false;
  return isEvent(row.event) && PUBLIC_TREE_KINDS.has(row.event.kind) && verifyEvent(row.event);
}

function readStorage(storage: StorageLike): Observation[] {
  try {
    const value = storage.getItem(STORAGE_KEY);
    if (!value || value.length > MAX_STORAGE_CHARS) return [];
    const rows: unknown = JSON.parse(value);
    return Array.isArray(rows) && rows.length <= MAX_RECORDS ? rows.filter(isObservation).map((row) => ({ relay: publicRelay(row.relay)!, observed: row.observed, event: signedFields(row.event) })) : [];
  } catch {
    return [];
  }
}

function matchesEvent(filter: ReturnType<typeof asFilters>[number], event: NostrEvent): boolean {
  // Applesauce's standard matcher treats until=0 as absent.
  return (filter.until !== 0 || event.created_at <= 0) && matchFilter(filter, event);
}

function signedFields({ id, kind, pubkey, created_at, content, tags, sig }: NostrEvent): NostrEvent {
  return { id, kind, pubkey, created_at, content, tags, sig };
}

function compareEvents(a: Observation, b: Observation): number {
  return b.event.created_at - a.event.created_at || a.event.id.localeCompare(b.event.id);
}

/** D-069: a shared observation is replayable only through an approved read of its source relay. */
export function createOutboxEventCache(storage?: StorageLike) {
  let rows: Observation[] | undefined;
  let flush: ReturnType<typeof setTimeout> | undefined;
  const load = () => (rows ??= storage ? readStorage(storage) : []);

  function persist(): void {
    if (flush === undefined) return;
    clearTimeout(flush);
    flush = undefined;
    try {
      const encoded = load().map((row) => JSON.stringify(row));
      let size = 2;
      const kept = encoded.filter((row) => (size += row.length + 1) <= MAX_STORAGE_CHARS);
      storage!.setItem(STORAGE_KEY, `[${kept.join(',')}]`);
    } catch {
      // Storage quotas and unavailable browser storage cannot break a relay read.
    }
  }

  function open(filters: Filters, plan: OutboxRelayPlan, authors: readonly string[] | undefined) {
    const relays = plannedRelays(plan);
    if (relays.size === 0 || filters.length > MAX_FILTERS || (authors?.length ?? 0) > MAX_FILTER_VALUES) return undefined;
    const understood = filters.filter(supportedFilter);
    const supported = asFilters(understood.filter((filter) => filter.kinds?.some((kind) => PUBLIC_TREE_KINDS.has(kind))));
    if (supported.length === 0) return undefined;
    const limited = filters.some((filter) => filter.limit !== undefined);
    const matchesAuthor = (event: NostrEvent) => !authors || authors.includes(event.pubkey);

    return {
      // A relay-only extension (e.g. search) cannot be evaluated when allocating per-filter limits.
      canMergeQuery: understood.length === filters.length || !limited,
      limitQuery(events: RelayEventResult[]): RelayEventResult[] {
        if (!limited) return events;
        const selected = new Set<string>();
        for (const filter of asFilters(understood)) {
          const matches = events.filter(({ event }) => matchesEvent(filter, event));
          for (const match of matches.slice(0, filter.limit)) selected.add(match.event.id);
        }
        return events.filter(({ event }) => selected.has(event.id));
      },
      replay(): RelayEventResult[] {
        const fresh = load().filter((row) => relays.has(row.relay) && row.observed > Date.now() - MAX_AGE_MS);
        const events = fresh.filter((row) => matchesAuthor(row.event)).sort(compareEvents);
        const results = new Map<string, RelayEventResult>();
        for (const filter of supported) {
          const ids = new Set<string>();
          for (const row of events) {
            if (!matchesEvent(filter, row.event) || (!ids.has(row.event.id) && ids.size >= (filter.limit ?? MAX_REPLAY))) continue;
            const existing = results.get(row.event.id);
            if (!existing && results.size >= MAX_REPLAY) continue;
            ids.add(row.event.id);
            const hints = new Set([...(existing?.sidecar?.relayHints ?? []), row.relay]);
            results.set(row.event.id, createRelayEventResultWithHints(row.event, [...hints]));
          }
        }
        return [...results.values()];
      },
      observe(result: RelayEventResult): void {
        const event = signedFields(result.event);
        const [url, ...extra] = result.sidecar?.relayHints ?? [];
        const relay = url && publicRelay(url);
        if (!relay || extra.length !== 0 || !relays.has(relay) || !PUBLIC_TREE_KINDS.has(event.kind)) return;
        if (!matchesAuthor(event) || !supported.some((filter) => matchesEvent(filter, event))) return;
        if (JSON.stringify(event).length > MAX_EVENT_CHARS) return;
        const row: Observation = { relay, observed: Date.now(), event };
        const recent = load().filter((old) => old.observed > row.observed - MAX_AGE_MS);
        rows = [row, ...recent.filter((old) => old.relay !== relay || old.event.id !== event.id)].slice(0, MAX_RECORDS);
        if (storage) flush ??= setTimeout(persist, 50);
      },
    };
  }

  return { open, persist };
}
