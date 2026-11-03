import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import type { RelayPoolHooks } from '@kehto/shell';
import {
  createAppletRelayBackend,
  createDmRelayPool,
  createOutboxRelayPool,
  createRelayPoolHooks,
  createRelayPoolLike,
  selectRelayTier,
  subscribeWithEose,
  type RelayTier,
  type RelayTiers,
} from '@kernl/core';
import { createFakePool, last, scratch, signEvent, splitList, type CoreWorld, type ReqMessage } from './world.js';

interface Delivered {
  events: NostrEvent[];
  eose: number;
  completed: boolean;
  errored: boolean;
}

function tiers(world: CoreWorld): RelayTiers {
  return scratch(world).tiers as RelayTiers;
}

function delivered(world: CoreWorld): Delivered {
  const state = scratch(world);
  state.delivered ??= { events: [], eose: 0, completed: false, errored: false };
  return state.delivered as Delivered;
}

function receive(world: CoreWorld): (item: NostrEvent | 'EOSE') => void {
  const box = delivered(world);
  return (item) => {
    if (item === 'EOSE') box.eose += 1;
    else box.events.push(item);
  };
}

async function sampleEvents(count: number, kind = 1): Promise<NostrEvent[]> {
  const events: NostrEvent[] = [];
  for (let i = 0; i < count; i += 1) events.push(await signEvent({ kind, content: `event ${i}`, created_at: 1_700_000_000 + i }));
  return events;
}

function filtersFor(kinds: string): NostrFilter[] {
  return [{ kinds: splitList(kinds).map(Number) }];
}

function tierRelays(world: CoreWorld, tier: string): string[] {
  const config = tiers(world).get();
  if (tier === 'general') return [...new Set([...config.super, ...config.outbox])];
  return [...config[tier as RelayTier]];
}

function hooks(world: CoreWorld): RelayPoolHooks {
  const value = scratch(world).hooks as RelayPoolHooks | undefined;
  if (!value) throw new Error('create relay pool hooks first');
  return value;
}

Given('a fake applesauce pool', (world: CoreWorld) => {
  scratch(world).pool = createFakePool();
});

Given('the fake pool serves {int} events', async (world: CoreWorld, count: number) => {
  scratch(world).pool.events = await sampleEvents(count);
});

Given('the fake pool fails requests', (world: CoreWorld) => {
  scratch(world).pool.failRequests = true;
});

Given('the fake pool refuses publishes', (world: CoreWorld) => {
  scratch(world).pool.publishOk = false;
});

Given('the fake pool also emits a {string} from {string}', (world: CoreWorld, type: string, from: string) => {
  const message: ReqMessage = type === 'CLOSED' ? { type: 'CLOSED', from, id: 'sub', reason: 'closed' } : { type: 'ERROR', from, error: new Error('x') };
  scratch(world).pool.extra.push(message);
});

Given('the fake pool also emits an {string} from {string}', (world: CoreWorld, type: string, from: string) => {
  const message: ReqMessage = type === 'CLOSED' ? { type: 'CLOSED', from, id: 'sub', reason: 'closed' } : { type: 'ERROR', from, error: new Error('x') };
  scratch(world).pool.extra.push(message);
});

When('the shell selects relays for kinds {string}', (world: CoreWorld, kinds: string) => {
  scratch(world).selected = selectRelayTier(tiers(world), filtersFor(kinds));
});

When('the shell selects relays for filters without kinds', (world: CoreWorld) => {
  scratch(world).selected = selectRelayTier(tiers(world), [{ authors: ['abc'] }]);
});

When('the shell selects relays for an empty kinds list', (world: CoreWorld) => {
  scratch(world).selected = selectRelayTier(tiers(world), [{ kinds: [] }]);
});

Then('the selected relays are the {string} tier', (world: CoreWorld, tier: string) => {
  expect(scratch(world).selected).toEqual(tierRelays(world, tier));
});

Then('the selected relays are {string}', (world: CoreWorld, urls: string) => {
  expect(scratch(world).selected).toEqual(splitList(urls));
});

When('the shell subscribes with EOSE on {string}', (world: CoreWorld, relays: string) => {
  subscribeWithEose(scratch(world).pool, splitList(relays), [{ kinds: [1] }], receive(world));
});

Then('the subscription delivered {int} events and {int} EOSE', (world: CoreWorld, events: number, eose: number) => {
  expect(delivered(world).events).toHaveLength(events);
  expect(delivered(world).eose).toBe(eose);
});

Then('the fake pool received a {string} for {string}', (world: CoreWorld, method: string, relays: string) => {
  const call = last(scratch(world).pool.calls.filter((entry) => entry.method === method));
  expect(call.relays).toEqual(splitList(relays));
});

Then('the fake pool received a {string} for the {string} tier', (world: CoreWorld, method: string, tier: string) => {
  const call = last(scratch(world).pool.calls.filter((entry) => entry.method === method));
  expect(call.relays).toEqual(tierRelays(world, tier));
});

When('the shell uses the RelayPoolLike adapter to subscribe on {string}', (world: CoreWorld, relays: string) => {
  const like = createRelayPoolLike(scratch(world).pool);
  const callback = receive(world);
  like.subscription(splitList(relays), [{ kinds: [1] }]).subscribe((item) => callback(item as NostrEvent | 'EOSE'));
});

When('the shell uses the RelayPoolLike adapter to request on {string}', (world: CoreWorld, relays: string) => {
  const like = createRelayPoolLike(scratch(world).pool);
  scratch(world).delivered = undefined;
  const box = delivered(world);
  scratch(world).requestHandle = like.request(splitList(relays), [{ kinds: [1] }]).subscribe({
    next: (event) => box.events.push(event as NostrEvent),
    complete: () => (box.completed = true),
    error: () => (box.errored = true),
  });
});

Then('the request handle can be unsubscribed', (world: CoreWorld) => {
  expect(() => (scratch(world).requestHandle as { unsubscribe(): void }).unsubscribe()).not.toThrow();
});

Then('the relay pool hooks select the {string} tier for kinds {string}', (world: CoreWorld, tier: string, kinds: string) => {
  expect(hooks(world).selectRelayTier(filtersFor(kinds))).toEqual(tierRelays(world, tier));
});

When('the shell uses the RelayPoolLike adapter to publish to {string}', async (world: CoreWorld, relays: string) => {
  const like = createRelayPoolLike(scratch(world).pool);
  await like.publish(splitList(relays), await signEvent({ kind: 1 }));
});

Then('the request delivered {int} events and completed', (world: CoreWorld, count: number) => {
  expect(delivered(world).events).toHaveLength(count);
  expect(delivered(world).completed).toBe(true);
});

Then('the request errored', (world: CoreWorld) => {
  expect(delivered(world).errored).toBe(true);
});

Given('kernl relay pool hooks', (world: CoreWorld) => {
  const state = scratch(world);
  state.hooks = createRelayPoolHooks(state.pool, tiers(world));
  state.cleanups = 0;
  state.scopedMessages = [];
});

When('the shell tracks subscription {string}', (world: CoreWorld, key: string) => {
  const state = scratch(world);
  hooks(world).trackSubscription(key, () => {
    state.cleanups = (state.cleanups as number) + 1;
  });
});

When('the shell untracks subscription {string}', (world: CoreWorld, key: string) => {
  hooks(world).untrackSubscription(key);
});

Then('{int} tracked cleanups ran', (world: CoreWorld, count: number) => {
  expect(scratch(world).cleanups).toBe(count);
});

When('the shell opens a scoped relay {string} for window {string}', (world: CoreWorld, relay: string, windowId: string) => {
  const messages = scratch(world).scopedMessages as unknown[];
  hooks(world).openScopedRelay(windowId, relay, 'sub-1', [{ kinds: [1] }], { postMessage: (message) => void messages.push(message) });
});

When('the shell closes the scoped relay of window {string}', (world: CoreWorld, windowId: string) => {
  hooks(world).closeScopedRelay(windowId);
});

When('the shell publishes to the scoped relay of window {string}', async (world: CoreWorld, windowId: string) => {
  scratch(world).scopedPublish = await hooks(world).publishToScopedRelay(windowId, await signEvent({ kind: 1 }));
});

Then('the scoped target received envelope types {string}', (world: CoreWorld, types: string) => {
  const messages = scratch(world).scopedMessages as Array<{ type: string }>;
  expect(messages.map((message) => message.type)).toEqual(splitList(types));
});

Then('the scoped publish succeeded', (world: CoreWorld) => {
  expect(scratch(world).scopedPublish).toBe(true);
});

Then('the scoped publish failed', (world: CoreWorld) => {
  expect(scratch(world).scopedPublish).toBe(false);
});

When('the applet relay backend subscribes to kinds {string} without hints', (world: CoreWorld, kinds: string) => {
  createAppletRelayBackend(scratch(world).pool, tiers(world)).subscribe(filtersFor(kinds), receive(world));
});

When('the applet relay backend subscribes to kinds {string} hinted to {string}', (world: CoreWorld, kinds: string, relays: string) => {
  createAppletRelayBackend(scratch(world).pool, tiers(world)).subscribe(filtersFor(kinds), receive(world), splitList(relays), true);
});

When('the applet relay backend publishes a kind {int} event', async (world: CoreWorld, kind: number) => {
  await createAppletRelayBackend(scratch(world).pool, tiers(world)).publish(await signEvent({ kind }));
});

Then('the applet relay backend is available', (world: CoreWorld) => {
  const backend = createAppletRelayBackend(scratch(world).pool, tiers(world));
  expect(backend.isAvailable()).toBe(true);
  expect(backend.selectRelayTier([{ kinds: [0] }])).toEqual(tierRelays(world, 'discovery'));
});

When('the messaging relay pool subscribes to kinds {string} without hints', (world: CoreWorld, kinds: string) => {
  createDmRelayPool(scratch(world).pool, tiers(world)).subscribe(filtersFor(kinds), receive(world));
});

When('the messaging relay pool queries kinds {string} without hints', async (world: CoreWorld, kinds: string) => {
  const dmPool = createDmRelayPool(scratch(world).pool, tiers(world));
  scratch(world).queried = await dmPool.query?.(filtersFor(kinds));
});

When('the messaging relay pool queries kinds {string} hinted to {string}', async (world: CoreWorld, kinds: string, relays: string) => {
  const dmPool = createDmRelayPool(scratch(world).pool, tiers(world));
  scratch(world).queried = await dmPool.query?.(filtersFor(kinds), splitList(relays));
});

When('the messaging relay pool publishes a kind {int} event', async (world: CoreWorld, kind: number) => {
  await createDmRelayPool(scratch(world).pool, tiers(world)).publish(await signEvent({ kind }));
});

Then('the query returned {int} events', (world: CoreWorld, count: number) => {
  expect(scratch(world).queried).toHaveLength(count);
});

Then('the messaging relay pool is available and selects the {string} tier for kinds {string}', (world: CoreWorld, tier: string, kinds: string) => {
  const dmPool = createDmRelayPool(scratch(world).pool, tiers(world));
  expect(dmPool.isAvailable()).toBe(true);
  expect(dmPool.selectRelayTier(filtersFor(kinds))).toEqual(tierRelays(world, tier));
});

When('the outbox relay pool subscribes on {string}', (world: CoreWorld, relays: string) => {
  createOutboxRelayPool(scratch(world).pool).subscribe([{ kinds: [1] }], splitList(relays), receive(world));
});

When('the outbox relay pool publishes to {string}', async (world: CoreWorld, relays: string) => {
  scratch(world).outcomes = await createOutboxRelayPool(scratch(world).pool).publish(await signEvent({ kind: 1 }), splitList(relays));
});

Then('the outbox publish reported {string} as accepted', (world: CoreWorld, relays: string) => {
  expect(scratch(world).outcomes).toEqual(Object.fromEntries(splitList(relays).map((url) => [url, true])));
});

Then('the outbox relay pool is available', (world: CoreWorld) => {
  expect(createOutboxRelayPool(scratch(world).pool).isAvailable()).toBe(true);
});
