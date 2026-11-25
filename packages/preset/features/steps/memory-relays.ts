import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { lastValueFrom, toArray } from 'rxjs';
import { RelayPool, type PublishResponse } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';
import type { NostrEvent } from 'applesauce-core/helpers';
import { createMemoryRelays, type MemoryRelays } from '@kernlize/preset';

interface RelaysWorld {
  relays: MemoryRelays;
  pool: RelayPool;
  responses: PublishResponse[];
  received: NostrEvent[];
  heard: NostrEvent[];
  socket?: InstanceType<MemoryRelays['WebSocket']> & { onclose: ((event: unknown) => void) | null; onmessage: ((event: unknown) => void) | null };
  closes: number;
  answers: number;
}

const signer = new PrivateKeySigner();
let clock = 1_700_000_000;
const sign = (kind: number, content = '', tags: string[][] = []): Promise<NostrEvent> => signer.signEvent({ kind, content, tags, created_at: (clock += 10) });
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));
const urls = (count: number): string[] => Array.from({ length: count }, (_, index) => `wss://relay${index}.example/`);

function open(world: RelaysWorld, refusing?: string[]): void {
  world.relays = refusing ? createMemoryRelays({ refusing }) : createMemoryRelays();
  world.pool = new RelayPool({ WebSocket: world.relays.WebSocket });
  world.responses = [];
  world.received = [];
  world.heard = [];
}

Given('relays that live in the page', (world: RelaysWorld) => open(world));

Given('relays that live in the page, where {string} refuses everything', (world: RelaysWorld, url: string) => open(world, [url]));

Given('relays that live in the page, seeded with {int} notes and a profile', async (world: RelaysWorld, count: number) => {
  open(world);
  for (let index = 0; index < count; index += 1) world.relays.seed(await sign(1, `note ${index}`));
  world.relays.seed(await sign(0, '{}'));
});

When('a note is published to {int} of them', async (world: RelaysWorld, count: number) => {
  world.responses = await world.pool.publish(urls(count), await sign(1, 'hello'));
});

When('a note is published to {string} and {string}', async (world: RelaysWorld, first: string, second: string) => {
  world.responses = await world.pool.publish([first, second], await sign(1, 'hello'));
});

When('the pool requests notes with a limit of {int}', async (world: RelaysWorld, limit: number) => {
  world.received = await lastValueFrom(world.pool.request(urls(1), [{ kinds: [1], limit }]).pipe(toArray()));
});

When('a profile is published, then a newer profile, then an ephemeral event, then addressable events with and without a d tag', async (world: RelaysWorld) => {
  for (const event of [await sign(0, '{"name":"old"}'), await sign(0, '{"name":"new"}'), await sign(20001, 'gone'), await sign(30078, 'kept'), await sign(30078, 'named', [['t', 'x'], ['d', 'notes']])]) {
    await world.pool.publish(urls(1), event);
  }
});

When('the pool subscribes to notes, then a profile and a note are published, then the subscription closes and another note is published', async (world: RelaysWorld) => {
  const subscription = world.pool.subscription(urls(1), [{ kinds: [1] }]).subscribe((message) => {
    if (typeof message !== 'string') world.heard.push(message);
  });
  await settle();
  await world.pool.publish(urls(1), await sign(0, '{"name":"not a note"}'));
  await world.pool.publish(urls(1), await sign(1, 'first'));
  await settle();
  subscription.unsubscribe();
  await settle();
  await world.pool.publish(urls(1), await sign(1, 'second'));
  await settle();
});

Given('a socket to one of the relays that live in the page', async (world: RelaysWorld) => {
  open(world);
  world.closes = 0;
  world.answers = 0;
  world.socket = new world.relays.WebSocket('wss://one.example') as RelaysWorld['socket'];
  world.socket!.onclose = () => (world.closes += 1);
  world.socket!.onmessage = () => (world.answers += 1);
  await settle();
});

When('the socket is closed twice', async (world: RelaysWorld) => {
  world.socket!.close();
  world.socket!.close();
  await settle();
});

Then('every one of the {int} relays accepted it', (world: RelaysWorld, count: number) => {
  expect(world.responses.filter((response) => response.ok).map((response) => response.from).sort()).toEqual(urls(count).sort());
});

Then('the relays hold {int} event(s)', (world: RelaysWorld, count: number) => {
  expect(world.relays.events()).toHaveLength(count);
});

Then('{string} accepted it and {string} refused it', (world: RelaysWorld, yes: string, no: string) => {
  const answered = (url: string) => world.responses.find((response) => response.from === new URL(url).href)?.ok;
  expect(answered(yes)).toBe(true);
  expect(answered(no)).toBe(false);
});

Then('it gets the {int} newest notes, newest first', (world: RelaysWorld, count: number) => {
  const notes = world.relays.events().filter((event) => event.kind === 1);
  expect(world.received.map((event) => event.content)).toEqual(notes.slice(0, count).map((event) => event.content));
});

Then('the relays hold the newer profile and the two addressable events only', (world: RelaysWorld) => {
  expect(world.relays.events().map((event) => event.content).sort()).toEqual(['kept', 'named', '{"name":"new"}']);
});

Then('the subscription heard exactly the first note', (world: RelaysWorld) => {
  expect(world.heard.map((event) => event.content)).toEqual(['first']);
});

Then('it reported closing once, and a later message gets no answer', async (world: RelaysWorld) => {
  world.socket!.send(JSON.stringify(['REQ', 'late', { kinds: [1] }]));
  world.socket!.send(JSON.stringify(['COUNT', 'late', { kinds: [1] }]));
  await settle();
  expect(world.closes).toBe(1);
  expect(world.answers).toBe(0);
});
