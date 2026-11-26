import { createRelayEventResultWithHints as result } from '@kehto/runtime';
import type { OutboxRelayPlan } from '@kehto/services';
import { finalizeEvent } from 'applesauce-core/helpers';
import { describe, expect, it, vi } from 'vitest';
import { createOutboxEventCache } from './outbox-event-cache.js';

const RELAY = 'wss://nos.lol';
const PLAN: OutboxRelayPlan = { relays: [RELAY], source: 'policy' };
const FILTER = { kinds: [31971] };
const KEY = Uint8Array.from({ length: 32 }, () => 1);
function sign(kind = 31971, content = '', tags: string[][] = [], key = KEY) {
  return finalizeEvent({ kind, content, tags, created_at: 1234 }, key);
}

function store(raw: string | null = null) {
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; }, removeItem: () => { raw = null; } };
  return { storage, cache: createOutboxEventCache(storage) };
}

function open(cache: ReturnType<typeof createOutboxEventCache>, filters = [FILTER], plan = PLAN, authors?: string[]) {
  return cache.open(filters, plan, authors)!;
}

describe('the public Outbox observation cache', () => {
  it('matches bounded filters and never guesses about unsupported filters', () => {
    const { cache } = store();
    const event = sign();
    open(cache).observe(result(event, [`${RELAY}/`]));
    expect(open(cache, [{ ...FILTER, limit: 0 }]).replay()).toEqual([]);
    expect(open(cache, [{ ...FILTER, since: 1234, until: 1234, limit: 1, ids: [event.id] }]).replay()[0]?.sidecar?.relayHints).toEqual([RELAY]);
    expect(open(cache, [{ ...FILTER, until: 0 }]).replay()).toEqual([]);
    for (const filters of [[{ ...FILTER, search: 'a' }], [{ ...FILTER, limit: -1 }], Array(33).fill(FILTER)]) {
      expect(open(cache, filters)).toBeUndefined();
    }
    expect(open(cache, [FILTER], PLAN, Array(257).fill(event.pubkey))).toBeUndefined();
    cache.persist();
  });

  it('ignores ambiguous provenance, oversized events and deletion-only subscriptions', () => {
    const { cache } = store();
    const observation = open(cache);
    const event = sign();
    observation.observe(result(event));
    observation.observe(result(event, [RELAY, 'wss://relay.routstr.com']));
    observation.observe(result(sign(31971, 'x'.repeat(18_000)), [RELAY]));
    expect(observation.replay()).toEqual([]);
    observation.observe(result(event, [RELAY]));
    expect(open(cache, [{ kinds: [5] }])).toBeUndefined();
    expect(observation.replay().map((entry) => entry.event.id)).toEqual([event.id]);
    cache.persist();
  });

  it('favors newest ids for per-filter and replay caps', () => {
    const { cache } = store();
    const observation = open(cache);
    const sameTime = [sign(31971, 'A'), sign(31971, 'B')];
    for (const event of sameTime) observation.observe(result(event, [RELAY]));
    const [winner] = sameTime.map((event) => event.id).sort();
    expect(open(cache, [{ ...FILTER, limit: 1 }]).replay().map((r) => r.event.id)).toEqual([winner]);
    for (let index = 0; index < 129; index++) observation.observe(result(sign(31971, `${index}`), [RELAY]));
    expect(open(cache, [{ ...FILTER, limit: 256 }]).replay()).toHaveLength(128);
    cache.persist();
  });

  it('ignores invalid or expired persisted data and verifies signatures after storage', () => {
    const signed = sign();
    const row = { relay: RELAY, observed: Date.now(), event: signed };
    const candidates = [null, { ...row, relay: 'wss://private.test' }, { ...row, observed: 0 }, { ...row, event: { ...signed, content: 'changed' } }, row];
    const { cache } = store(JSON.stringify(candidates));
    expect(open(cache).replay().map((entry) => entry.event.id)).toEqual([signed.id]);
    expect(open(store('{}').cache).replay()).toEqual([]);
    expect(open(store('x'.repeat(256_001)).cache).replay()).toEqual([]);
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(24 * 60 * 60 * 1_000);
      expect(open(cache).replay()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

it('keeps observations in memory when the host offers no session backing', () => {
  const cache = createOutboxEventCache();
  const event = sign();
  open(cache).observe(result(event, [RELAY]));
  expect(open(cache).replay()).toHaveLength(1);
  cache.persist();
  expect(open(createOutboxEventCache()).replay()).toEqual([]);
});
