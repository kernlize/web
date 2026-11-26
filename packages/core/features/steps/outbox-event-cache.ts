import { EventStore } from 'applesauce-core';
import { merge, Subject } from 'rxjs';
import type { ApprovalSignal, RelayEventResult, ServiceHandler, ServiceRuntimeContext } from '@kehto/runtime';
import type { NappletMessage, NostrFilter } from '@napplet/core';
import { createKernlServices, createRelayTiers } from '@kernlize/kernel';
import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { allowAllSigning, createFakePool, MemoryStorage, signEvent, type CoreWorld, type ReqMessage } from './world.js';

const FIRST = 'wss://nos.lol';
const SECOND = 'wss://relay.routstr.com';
const WINDOW = 'tree-window';
const ROOT = 'tree';
const TREE: NostrFilter = { kinds: [31971], '#A': [ROOT] };
type Event = Awaited<ReturnType<typeof signEvent>>;

function state(storage = new MemoryStorage()) {
  const pool = createFakePool();
  const sent: NappletMessage[] = [];
  const timeline: string[] = [];
  let onSend: ((response: NappletMessage) => void) | undefined;
  let authorize: () => Promise<boolean> = async () => true;
  let artifact: string | undefined = 'first-artifact';
  let identity: string | null = 'first-user';
  const req = pool.req.bind(pool);
  pool.req = (...args) => {
    timeline.push(...(args[0] as string[]));
    return req(...args);
  };
  const service = createKernlServices({
    pool,
    tiers: createRelayTiers(storage, { super: [] }),
    eventStore: new EventStore(),
    cacheOutboxReads: true,
    auth: { getSigner: () => null, getUserPubkey: () => identity },
    consent: allowAllSigning,
    host: { storage, outboxCacheStorage: storage, notify() {}, openLink() {} },
    shortcuts: { isFocused: () => true },
    resolveIdentity: () => artifact ? { dTag: 'test-tree', aggregateHash: artifact } : null,
  }).registry.outbox as ServiceHandler;
  service.onRegistered?.({
    authorizeOperation: async (_window, _operation, _requirements, execute) => (await authorize())
      ? { status: 'executed', value: await execute(new AbortController().signal as ApprovalSignal) }
      : { status: 'denied' },
  } as ServiceRuntimeContext);
  return {
    service, pool, sent, timeline, storage,
    onSendWith(next: typeof onSend) { onSend = next; },
    authorizeWith(fn: typeof authorize) { authorize = fn; },
    swapArtifact() { artifact = 'other-artifact'; },
    swapIdentity() { identity = 'other-user'; },
    send(message: NappletMessage) {
      service.handleMessage(WINDOW, message, (response) => {
        timeline.push(response.type);
        sent.push(response);
        onSend?.(response);
      });
    },
  };
}

interface Fixture {
  current: ReturnType<typeof state>;
  event: Event;
  relays: string[];
  filter: NostrFilter;
  firstQueryTick?: boolean;
  pushed?: Subject<ReqMessage>;
}

const worlds = new WeakMap<CoreWorld, Fixture>();
const fixture = (world: CoreWorld): Fixture => worlds.get(world)!;
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
const relayList = (relays: string) => relays.split(',').map((url) => url.trim());
const results = (s: Fixture): RelayEventResult[] => s.current.sent.flatMap((m) => m.type === 'outbox.event' && 'result' in m ? [m.result as RelayEventResult] : []);

function subscribe(s: Fixture, options: { filters?: NostrFilter; relays?: string[]; authors?: string[]; subId?: string } = {}): void {
  const { filters = s.filter, relays = s.relays, authors, subId = 'live' } = options;
  s.current.send({ type: 'outbox.subscribe', subId, filters, options: { relays, authors } } as NappletMessage);
}

function clear(s: Fixture): void {
  s.current.send({ type: 'outbox.close', subId: 'live' } as NappletMessage);
  s.current.sent.length = 0;
  s.current.timeline.length = 0;
  s.current.pool.events = [];
}

async function observe(world: CoreWorld, event: Event, relays: string[], filter: NostrFilter): Promise<void> {
  const current = state();
  const s = { current, event, relays, filter };
  worlds.set(world, s);
  current.pool.events = [event];
  subscribe(s);
  await settle();
  current.service.onUnregistered?.();
  s.current = state(current.storage);
}

Given('a previously observed Outbox tree event on {string}', async (world: CoreWorld, relay: string) => {
  const event = await signEvent({ kind: 31971, tags: [['A', ROOT], ['d', 'problem']] });
  await observe(world, event, [relay], TREE);
});

When('its applet subscribes to the tree on {string}', async (world: CoreWorld, relays: string) => {
  const s = fixture(world);
  subscribe(s, { relays: relayList(relays) });
  await settle();
});

Then('the cached tree event is sent before opening the two approved relays', (world: CoreWorld) => {
  const s = fixture(world);
  expect(s.current.timeline).toEqual(['outbox.event', FIRST, SECOND]);
  expect(results(s).map(({ event, sidecar }) => ({ id: event.id, hints: sidecar?.relayHints }))).toEqual([{ id: s.event.id, hints: [FIRST] }]);
});

Then('a live copy from the same relay does not repeat the event', async (world: CoreWorld) => {
  const s = fixture(world);
  clear(s);
  s.current.pool.events = [s.event];
  subscribe(s);
  await settle();
  expect(results(s)).toHaveLength(1);
});

Then('a live copy from another approved relay adds its observed hint', async (world: CoreWorld) => {
  const s = fixture(world);
  clear(s);
  s.current.pool.extra = [{ type: 'EVENT', from: SECOND, id: 'sub', event: s.event }];
  // The fake emits extra messages to each connection, so scope the extra emission to the actual relay.
  const req = s.current.pool.req.bind(s.current.pool);
  s.current.pool.req = (...args) => {
    s.current.pool.extra = (args[0] as string[]).includes(SECOND) ? [{ type: 'EVENT', from: SECOND, id: 'sub', event: s.event }] : [];
    return req(...args);
  };
  subscribe(s, { relays: [FIRST, SECOND] });
  await settle();
  expect(results(s).map((result) => result.sidecar?.relayHints)).toEqual([[FIRST], [FIRST, SECOND]]);
});

When(/^an Outbox read changes its (.+)$/u, async (world: CoreWorld, boundary: string) => {
  const s = fixture(world);
  if (boundary === 'relay plan') s.relays = [SECOND];
  if (boundary === 'filter author') s.filter = { ...TREE, authors: ['f'.repeat(64)] };
  if (boundary === 'filter tag') s.filter = { ...TREE, '#A': ['a different tree'] };
  if (boundary === 'firewall answer') s.current.authorizeWith(async () => false);
  if (boundary === 'subscription close' || boundary === 'window teardown' || boundary === 'permission revocation' || boundary === 'capability revocation') {
    const approval = Promise.withResolvers<boolean>();
    s.current.authorizeWith(() => approval.promise);
    subscribe(s);
    await settle();
    if (boundary === 'subscription close') clear(s);
    if (boundary === 'window teardown') s.current.service.onWindowDestroyed?.(WINDOW);
    if (boundary === 'capability revocation') {
      s.current.service.onCapabilityRevoked?.(WINDOW, 'outbox:write');
      s.current.service.onCapabilityRevoked?.(WINDOW, 'outbox:read');
      s.current.service.onCapabilityRevoked?.(WINDOW, null);
    }
    if (boundary === 'permission revocation') s.current.service.onPermissionRevoked?.(WINDOW);
    approval.resolve(true);
  } else if (boundary === 'routed author') subscribe(s, { authors: ['f'.repeat(64)] });
  else subscribe(s);
  await settle();
  if (['firewall answer', 'subscription close', 'window teardown', 'permission revocation', 'capability revocation'].includes(boundary)) expect(s.current.timeline.filter((entry) => entry.startsWith('wss:'))).toEqual([]);
});

Then('no cached Outbox event is sent', (world: CoreWorld) => {
  expect(results(fixture(world))).toEqual([]);
});

When('its applet queries the tree on {string}', async (world: CoreWorld, relays: string) => {
  const s = fixture(world);
  s.current.send({ type: 'outbox.query', id: 'query', filters: s.filter, options: { relays: relayList(relays), timeoutMs: 80 } } as NappletMessage);
  await settle();
  s.firstQueryTick = s.current.sent.length === 0;
});

Then('the one-shot query waits for the relay deadline and returns the cached event with its observed hint', async (world: CoreWorld) => {
  const s = fixture(world);
  expect(s.firstQueryTick).toBe(true);
  await expect.poll(() => s.current.sent).toEqual([{ type: 'outbox.query.result', id: 'query', events: [{ event: JSON.parse(JSON.stringify(s.event)), sidecar: { relayHints: [FIRST] } }] }]);
  expect(s.current.timeline).toEqual([FIRST, SECOND, 'outbox.query.result']);
});

When("its applet explicitly subscribes to the author's deletion", async (world: CoreWorld) => {
  const s = fixture(world);
  const deletion = await signEvent({ kind: 5, tags: [['a', `31971:${s.event.pubkey}:problem`]], created_at: s.event.created_at + 1 });
  s.current.pool.events = [deletion];
  subscribe(s, { filters: { kinds: [5], '#a': [`31971:${s.event.pubkey}:problem`] } });
  await settle();
  expect(results(s).map(({ event }) => event.id)).toEqual([deletion.id]);
  s.current.service.onUnregistered?.();
  s.current = state(s.current.storage);
});

Given(/^an Outbox relay sent (.+)$/u, async (world: CoreWorld, eventType: string) => {
  const relay = eventType === "a private relay's tree event" ? 'wss://private.example' : FIRST;
  const kind = eventType === 'a draft on a public relay' ? 31234 : 31971;
  const event = await signEvent({ kind, tags: [['A', eventType === 'a nonmatching public event' ? 'another-tree' : ROOT]] });
  const candidate = eventType === 'an invalid signature' ? { ...event, sig: '00'.repeat(64) } : event;
  await observe(world, candidate, [relay], { ...TREE, kinds: [kind] });
});

When('its applet subscribes to the same Outbox filters and relay again', async (world: CoreWorld) => {
  subscribe(fixture(world));
  await settle();
});

When('its applet queries the two relays with the cached event and a new tree event online', async (world: CoreWorld) => {
  const s = fixture(world);
  s.current.pool.events = [s.event, await signEvent({ kind: 31971, tags: [['A', ROOT], ['d', 'new-problem']] })];
  s.current.send({ type: 'outbox.query', id: 'query', filters: s.filter, options: { relays: [FIRST, SECOND], timeoutMs: 30 } } as NappletMessage);
});

Then("the query returns both events once and keeps the cached event's observed hint", async (world: CoreWorld) => {
  const s = fixture(world);
  const [cached, fresh] = s.current.pool.events;
  await expect.poll(() => s.current.sent).toEqual([{ type: 'outbox.query.result', id: 'query', events: [{ event: cached, sidecar: { relayHints: [FIRST] } }, { event: fresh, sidecar: { relayHints: [FIRST, SECOND] } }] }]);
  // The one-shot router has only plan-wide hints, so it cannot create an observation for the new event.
  clear(s);
  subscribe(s, { relays: [FIRST, SECOND] });
  await settle();
  expect(results(s).map(({ event }) => event.id)).toEqual([s.event.id]);
});

Given('Outbox storage cannot be read or written', async (world: CoreWorld) => {
  const storage = new MemoryStorage();
  const current = state(storage);
  const unavailable = () => { throw new Error('storage unavailable'); };
  storage.getItem = unavailable;
  storage.setItem = unavailable;
  const event = await signEvent({ kind: 31971, tags: [['A', ROOT]] });
  worlds.set(world, { current, event, relays: [FIRST], filter: TREE });
});

When('its applet subscribes with a matching event on a public relay', async (world: CoreWorld) => {
  const s = fixture(world);
  s.current.pool.events = [s.event];
  subscribe(s);
  await settle();
});

Then('live Outbox still sends the event', (world: CoreWorld) => {
  const s = fixture(world);
  expect(s.current.timeline).toEqual([FIRST, 'outbox.event']);
  expect(results(s).map(({ event }) => event.id)).toEqual([s.event.id]);
  s.current.service.onUnregistered?.();
});

When(/^its applet queries with a (filter limit|limit) of one and a newer event online$/u, async (world: CoreWorld, source: string) => {
  const s = fixture(world);
  s.current.pool.events = [await signEvent({ kind: 31971, tags: [['A', ROOT], ['d', 'new']], created_at: s.event.created_at + 1 })];
  s.current.send({ type: 'outbox.query', id: 'query', filters: source === 'filter limit' ? { ...s.filter, limit: 1 } : s.filter, options: { relays: s.relays, timeoutMs: 30, ...(source === 'limit' ? { limit: 1 } : {}) } } as NappletMessage);
});

Then('only the newer event is returned at the query deadline', async (world: CoreWorld) => {
  const s = fixture(world);
  await expect.poll(() => s.current.sent).toEqual([{ type: 'outbox.query.result', id: 'query', events: [{ event: s.current.pool.events[0], sidecar: { relayHints: [FIRST] } }] }]);
});

When('the applet opens two live reads and closes the first', async (world: CoreWorld) => {
  const s = fixture(world);
  const req = s.current.pool.req.bind(s.current.pool);
  const pushed = new Subject<ReqMessage>();
  s.pushed = pushed;
  s.current.pool.req = (...args) => merge(req(...args), pushed) as ReturnType<typeof req>;
  subscribe(s);
  subscribe(s, { subId: 'second' });
  await settle();
  clear(s);
});

Then('only the second read receives another live event', async (world: CoreWorld) => {
  const s = fixture(world);
  const event = await signEvent({ kind: 31971, tags: [['A', ROOT], ['d', 'another-event']] });
  s.pushed!.next({ type: 'EVENT', from: FIRST, id: 'relay-sub', event });
  await settle();
  expect(s.current.sent).toEqual([{ type: 'outbox.event', subId: 'second', result: { event, sidecar: { relayHints: [FIRST] } } }]);
  s.current.service.onUnregistered?.();
});

When('the applet closes its subscription while receiving the cached event', async (world: CoreWorld) => {
  const s = fixture(world);
  s.current.onSendWith((response) => {
    if (response.type === 'outbox.event') s.current.send({ type: 'outbox.close', subId: 'live' } as NappletMessage);
  });
  subscribe(s);
  await settle();
});

Then('the cached event is delivered but no relay is opened', (world: CoreWorld) => {
  expect(fixture(world).current.timeline).toEqual(['outbox.event', 'outbox.closed']);
});

When('the first subscription is approved and a second subscription is denied', async (world: CoreWorld) => {
  const s = fixture(world);
  subscribe(s);
  await settle();
  s.current.authorizeWith(async () => false);
  subscribe(s, { subId: 'denied' });
  await settle();
});

Then('the cache is sent only to the approved subscription', (world: CoreWorld) => {
  const s = fixture(world);
  expect(s.current.timeline).toEqual(['outbox.event', FIRST, 'outbox.closed']);
  expect(results(s).map(({ event }) => event.id)).toEqual([s.event.id]);
});

When('its applet queries with a limit of one and another event at the same time', async (world: CoreWorld) => {
  const s = fixture(world);
  s.current.pool.events = [await signEvent({ kind: 31971, tags: [['A', ROOT], ['d', 'new']], created_at: s.event.created_at })];
  s.current.send({ type: 'outbox.query', id: 'query', filters: s.filter, options: { relays: s.relays, timeoutMs: 30, limit: 1 } } as NappletMessage);
});

Then('the lower event id is returned at the query deadline', async (world: CoreWorld) => {
  const s = fixture(world);
  const winner = [s.event.id, s.current.pool.events[0]!.id].sort()[0];
  await expect.poll(() => s.current.sent).toMatchObject([{ type: 'outbox.query.result', id: 'query', events: [{ event: { id: winner } }] }]);
});

When('its applet looks up the event by id', (world: CoreWorld) => {
  const s = fixture(world);
  s.current.pool.events = [s.event];
  s.current.send({ type: 'outbox.getEvent', id: 'by-id', eventId: s.event.id, options: { relays: s.relays, timeoutMs: 25 } } as NappletMessage);
});

Then('that id lookup contacts the relay normally', async (world: CoreWorld) => {
  const s = fixture(world);
  await expect.poll(() => s.current.sent).toMatchObject([{ type: 'outbox.getEvent.result', id: 'by-id', result: { event: { id: s.event.id } } }]);
  expect(s.current.timeline).toEqual([FIRST, 'outbox.getEvent.result']);
});

When('a different applet subscribes after the shell changes identity', async (world: CoreWorld) => {
  const s = fixture(world);
  s.current.swapArtifact();
  s.current.swapIdentity();
  subscribe(s);
  await settle();
});

Then('it receives the cached tree event before its relay opens', (world: CoreWorld) => {
  const s = fixture(world);
  expect(s.current.timeline).toEqual(['outbox.event', FIRST]);
  expect(results(s).map(({ event }) => event.id)).toEqual([s.event.id]);
});

Then('the deletion is delivered live but not cached and the tree event still replays', async (world: CoreWorld) => {
  const s = fixture(world);
  subscribe(s, { filters: { kinds: [5] } });
  await settle();
  expect(results(s)).toEqual([]);
  subscribe(s);
  await settle();
  expect(results(s).map(({ event }) => event.id)).toEqual([s.event.id]);
});

When('its applet queries with independently limited filters and an overall limit', async (world: CoreWorld) => {
  const s = fixture(world);
  const fresh = await signEvent({ kind: 31971, tags: [['A', ROOT]], created_at: s.event.created_at + 1 });
  const comment = await signEvent({ kind: 1111, tags: [], created_at: s.event.created_at - 1 });
  s.current.pool.events = [comment, fresh];
  const filters = [{ ...s.filter, limit: 1 }, { kinds: [1111], limit: 1 }];
  s.current.send({ type: 'outbox.query', id: 'query', filters, options: { relays: s.relays, timeoutMs: 30, limit: 2 } } as NappletMessage);
});

Then('the query returns the newest match from each limited filter', async (world: CoreWorld) => {
  const s = fixture(world);
  const ids = s.current.pool.events.map(({ id }) => id).reverse();
  await expect.poll(() => s.current.sent).toMatchObject([{ type: 'outbox.query.result', events: ids.map((id) => ({ event: { id } })) }]);
});
