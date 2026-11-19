import { createRequire } from 'node:module';
import { expect, vi } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { RelayPool } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';
import type { ServiceHandler, ServiceRuntimeContext } from '@kehto/runtime';
import type { NappletMessage, WebrtcEvent } from '@napplet/core';
import {
  createDirectConnectionsService,
  createDirectSignaling,
  createWindowIdentities,
  directNamespace,
  DIRECT_SIGNAL_KIND,
  type AppletSummary,
  type ConsentSummary,
  type DirectIceServer,
  type WindowIdentities,
} from '@kernlize/core';
import { startLoopbackRelay, type LoopbackRelay } from './loopback-relay.js';
import { WirePeer, type WireWorld } from './wire-peer.js';
import { scratch, splitList, type CoreWorld } from './world.js';

/** A real WebRTC stack for Node, with the browser's API. */
const { RTCPeerConnection: NodePeer } = createRequire(import.meta.url)('@roamhq/wrtc') as { RTCPeerConnection: typeof RTCPeerConnection };

const PUBLISHER = 'a1'.repeat(32);

interface Person {
  readonly windowId: string;
  readonly pool: RelayPool;
  readonly identities: WindowIdentities;
  readonly service: ServiceHandler;
  readonly ice: DirectIceServer[];
  readonly messages: NappletMessage[];
  readonly asked: ConsentSummary[];
  answer: boolean;
  granted: boolean;
  takeBackWhileAsked: boolean;
  sessions: string[];
  told?: string;
  key?: Uint8Array;
}

interface Direct {
  relay: LoopbackRelay;
  people: Map<string, Person>;
  pools: RelayPool[];
  peers: Array<{ close(): void }>;
  eve?: WirePeer;
  strangers?: WirePeer[];
  calls: number;
}

function direct(world: CoreWorld): Direct {
  const value = scratch(world).direct as Direct | undefined;
  if (!value) throw new Error('start the loopback relay first');
  return value;
}

function person(world: CoreWorld, name: string): Person {
  const value = direct(world).people.get(name);
  if (!value) throw new Error(`no one called ${name}`);
  return value;
}

const keyOf = (who: Person): Promise<string> => who.identities.signer(who.windowId).getPublicKey();

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 4_500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

After(async (world: CoreWorld) => {
  const state = scratch(world).direct as Direct | undefined;
  if (!state) return;
  vi.useRealTimers();
  delete (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
  for (const who of state.people.values()) who.service.onUnregistered?.();
  for (const peer of state.peers) peer.close();
  for (const pool of state.pools) pool.close();
  await state.relay.close();
});

function summaryFor(applet: string): Pick<AppletSummary, 'identity' | 'publisher' | 'manifest'> {
  return { identity: { dTag: applet, hash: 'cd'.repeat(32) }, publisher: PUBLISHER, manifest: { catalogId: `nip5d:35129:${PUBLISHER}:${applet}` } as AppletSummary['manifest'] };
}

function join(world: CoreWorld, name: string, applet: string | undefined, pagePeers: boolean): void {
  const state = direct(world);
  const pool = new RelayPool();
  state.pools.push(pool);
  const identities = createWindowIdentities();
  const ice: DirectIceServer[] = [];
  const who: Person = {
    windowId: `${name}-window`, pool, identities, ice, messages: [], asked: [], answer: true, granted: true, takeBackWhileAsked: false, sessions: [],
    service: createDirectConnectionsService({
      pool,
      relays: () => [state.relay.url],
      identities,
      iceServers: ice,
      ...(pagePeers ? {} : { createPeer: (configuration) => new NodePeer(configuration) }),
      appletOf: () => (applet ? summaryFor(applet) : undefined),
      isGranted: () => who.granted,
      async ask(summary) {
        who.asked.push(summary);
        if (who.takeBackWhileAsked) who.granted = false;
        return who.answer;
      },
    }),
  };
  who.service.onRegistered?.({} as ServiceRuntimeContext);
  state.people.set(name, who);
}

Given('a loopback relay that introduces people', async (world: CoreWorld) => {
  scratch(world).direct = { relay: await startLoopbackRelay(), people: new Map(), pools: [], peers: [], calls: 0 } satisfies Direct;
});

Given('{string} runs the applet {string} with direct connections granted', (world: CoreWorld, name: string, applet: string) => {
  join(world, name, applet, false);
});

Given("{string} runs the applet {string} with direct connections granted, using the page's own peer connections", (world: CoreWorld, name: string, applet: string) => {
  (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = NodePeer;
  join(world, name, applet, true);
});

Given('{string} runs an applet the shell cannot name, with direct connections granted', (world: CoreWorld, name: string) => {
  join(world, name, undefined, false);
});

Given('{string} is helped by the server {string}', (world: CoreWorld, name: string, url: string) => {
  person(world, name).ice.push({ urls: [url] });
});

Given('{string} will say no', (world: CoreWorld, name: string) => {
  person(world, name).answer = false;
});

Given('{string} has not granted direct connections', (world: CoreWorld, name: string) => {
  person(world, name).granted = false;
});

Given('{string} takes the grant back while she is asked', (world: CoreWorld, name: string) => {
  person(world, name).takeBackWhileAsked = true;
});

/** Send one message as the person's window and resolve with the reply of `type` to it. */
function call(world: CoreWorld, who: Person, message: Record<string, unknown>, type: string): Promise<NappletMessage & Record<string, unknown>> {
  const id = `call-${(direct(world).calls += 1)}`;
  return new Promise((resolve) => {
    who.service.handleMessage(who.windowId, { ...message, id } as NappletMessage, (reply) => {
      who.messages.push(reply);
      if (reply.type === type && (reply as { id?: string }).id === id) resolve(reply as NappletMessage & Record<string, unknown>);
    });
  });
}

async function open(world: CoreWorld, name: string, request: Record<string, unknown>): Promise<void> {
  const who = person(world, name);
  const reply = await call(world, who, { type: 'webrtc.open', request }, 'webrtc.open.result');
  who.told = reply.error as string | undefined;
  const session = reply.session as { id: string } | undefined;
  if (session) who.sessions.push(session.id);
  who.key = who.identities.signer(who.windowId).key;
}

When('{string} opens the room {string}', async (world: CoreWorld, name: string, room: string) => {
  await open(world, name, { scope: { type: 'room', room } });
});

When('{string} opens the room {string} again', async (world: CoreWorld, name: string, room: string) => {
  await open(world, name, { scope: { type: 'room', room } });
});

When('{string} opens the rooms {string} on the channel {string} with the protocol {string}', async (world: CoreWorld, name: string, rooms: string, channel: string, protocol: string) => {
  for (const room of splitList(rooms)) await open(world, name, { scope: { type: 'room', room }, channel, protocol });
});

When('{string} opens a direct session with {string}', async (world: CoreWorld, name: string, other: string) => {
  await open(world, name, { scope: { type: 'direct', pubkey: await keyOf(person(world, other)) } });
});

const REQUESTS: Record<string, (me: string) => Record<string, unknown>> = {
  'a room whose name is 257 characters long': () => ({ scope: { type: 'room', room: 'r'.repeat(257) } }),
  'the room "lobby-1234" with the peer "not-a-key"': () => ({ scope: { type: 'room', room: 'lobby-1234', peers: ['not-a-key'] } }),
  'a direct session with "not-a-key"': () => ({ scope: { type: 'direct', pubkey: 'not-a-key' } }),
  'the room "lobby-1234" on the channel ""': () => ({ scope: { type: 'room', room: 'lobby-1234' }, channel: '' }),
  'the room "lobby-1234" with a 129-character protocol': () => ({ scope: { type: 'room', room: 'lobby-1234' }, protocol: 'p'.repeat(129) }),
  'a direct session with herself': (me) => ({ scope: { type: 'direct', pubkey: me } }),
};

When(/^"([^"]+)" asks to open (.+)$/, async (world: CoreWorld, name: string, request: string) => {
  const build = REQUESTS[request];
  if (!build) throw new Error(`no such request: ${request}`);
  await open(world, name, build(await keyOf(person(world, name))));
});

const events = (who: Person): WebrtcEvent[] => who.messages.filter((message) => message.type === 'webrtc.event').map((message) => (message as { event: WebrtcEvent }).event);

function joined(who: Person, key: string): number {
  return events(who).filter((event) => event.type === 'peer' && event.state === 'joined' && event.pubkey === key).length;
}

Then('{string} and {string} see each other join and the session open', async (world: CoreWorld, one: string, other: string) => {
  const a = person(world, one);
  const b = person(world, other);
  const [aKey, bKey] = [await keyOf(a), await keyOf(b)];
  await until(() => joined(a, bKey) > 0 && joined(b, aKey) > 0);
  for (const who of [a, b]) expect(events(who).some((event) => event.type === 'state' && event.state === 'open')).toBe(true);
});

async function send(world: CoreWorld, name: string, payload: unknown): Promise<void> {
  const who = person(world, name);
  const reply = await call(world, who, { type: 'webrtc.send', sessionId: who.sessions[0], payload }, 'webrtc.send.result');
  who.told = reply.error as string | undefined;
}

When('{string} sends {string}', async (world: CoreWorld, name: string, json: string) => {
  await send(world, name, JSON.parse(json));
});

When('{string} sends a message of {int} bytes', async (world: CoreWorld, name: string, size: number) => {
  await send(world, name, 'x'.repeat(size));
});

When('{string} sends nothing at all', async (world: CoreWorld, name: string) => {
  await send(world, name, undefined);
});

function received(who: Person, from: string): unknown[] {
  return events(who).filter((event) => event.type === 'message' && event.from === from).map((event) => (event as { payload: unknown }).payload);
}

Then('{string} receives {string} from {string}', async (world: CoreWorld, name: string, json: string, from: string) => {
  const who = person(world, name);
  const sender = direct(world).people.get(from);
  const key = sender ? await keyOf(sender) : (direct(world).eve as WirePeer).pubkey;
  await until(() => received(who, key).some((payload) => JSON.stringify(payload) === JSON.stringify(JSON.parse(json))));
});

Then('{string} is told {string}', (world: CoreWorld, name: string, error: string) => {
  expect(person(world, name).told).toBe(error);
});

Then('{string} was asked {string}, marked {string}', (world: CoreWorld, name: string, title: string, severity: string) => {
  const [question] = person(world, name).asked;
  expect(question?.title).toBe(title);
  expect(question?.severity).toBe(severity);
  scratch(world).question = question;
});

Then('the question says {string} is {string}', (world: CoreWorld, label: string, text: string) => {
  const question = scratch(world).question as ConsentSummary;
  expect(question.lines.find((line) => line.label === label)?.after).toBe(text);
});

Then('the question names the loopback relay as what introduces them', (world: CoreWorld) => {
  const question = scratch(world).question as ConsentSummary;
  expect(question.lines.find((line) => line.label === 'Introduced by')?.after).toBe(new URL(direct(world).relay.url).host);
});

Then('{string} was asked with {string} saying {string}', (world: CoreWorld, name: string, label: string, text: string) => {
  expect(person(world, name).asked[0]?.lines.find((line) => line.label === label)?.after).toBe(text);
});

Then('{string} was not asked', (world: CoreWorld, name: string) => {
  expect(person(world, name).asked).toEqual([]);
});

Then('nothing was published for {string}', async (world: CoreWorld, name: string) => {
  const key = await keyOf(person(world, name));
  await pause(300);
  expect(direct(world).relay.published.filter((event) => event.pubkey === key)).toEqual([]);
});

Then('every signal was signed by a window\'s own key', async (world: CoreWorld) => {
  const keys = await Promise.all([...direct(world).people.values()].map(keyOf));
  const signals = direct(world).relay.published.filter((event) => event.kind === DIRECT_SIGNAL_KIND);
  expect(signals.length).toBeGreaterThan(0);
  for (const signal of signals) expect(keys).toContain(signal.pubkey);
});

Then('every offer and answer was sealed for the one peer it is for', (world: CoreWorld) => {
  const addressed = direct(world).relay.published.filter((event) => event.kind === DIRECT_SIGNAL_KIND && event.tags.some((tag) => tag[0] === 'p'));
  expect(addressed.length).toBeGreaterThan(0);
  for (const signal of addressed) {
    expect(signal.content).not.toContain('v=0');
    expect(signal.content.startsWith('{')).toBe(false);
  }
});

Then('after {int} seconds {string} has seen no one join', async (world: CoreWorld, seconds: number, name: string) => {
  await pause(seconds * 1000);
  expect(events(person(world, name)).filter((event) => event.type === 'peer')).toEqual([]);
});

When('{string} closes the session saying {string}', async (world: CoreWorld, name: string, reason: string) => {
  const who = person(world, name);
  await call(world, who, { type: 'webrtc.close', sessionId: who.sessions[0], reason }, 'webrtc.close.result');
});

When('{string} closes the session', async (world: CoreWorld, name: string) => {
  const who = person(world, name);
  await call(world, who, { type: 'webrtc.close', sessionId: who.sessions[0] }, 'webrtc.close.result');
});

Then('{string} is told the session closed saying {string}', (world: CoreWorld, name: string, reason: string) => {
  expect(events(person(world, name))).toContainEqual(expect.objectContaining({ type: 'closed', reason }));
});

Then('{string} is told the session closed', (world: CoreWorld, name: string) => {
  expect(events(person(world, name))).toContainEqual(expect.objectContaining({ type: 'closed' }));
});

Then('{string} sees {string} leave', async (world: CoreWorld, name: string, other: string) => {
  const key = await keyOf(person(world, other));
  await until(() => events(person(world, name)).some((event) => event.type === 'peer' && event.state === 'left' && event.pubkey === key));
});

When('{string} closes her window', (world: CoreWorld, name: string) => {
  const who = person(world, name);
  who.service.onWindowDestroyed?.(who.windowId);
});

Then('the key {string}\'s window signed under is all zeros', (world: CoreWorld, name: string) => {
  expect([...(person(world, name).key as Uint8Array)].every((byte) => byte === 0)).toBe(true);
});

Then('a signaling session for a {string} scope is refused with {string}', (_world: CoreWorld, type: string, error: string) => {
  const signaling = createDirectSignaling({ signer: new PrivateKeySigner(), namespace: 'n', relays: [], relay: { subscribe: () => ({ close: () => undefined }), publish: async () => undefined }, iceEndpoints: [], createPeer: () => new NodePeer() });
  expect(() => signaling.planOpen?.({ scope: { type } } as never, { windowId: 'w', emit: () => undefined })).toThrow(error);
});

Then('a send for a session the window does not hold is refused with {string}', (_world: CoreWorld, error: string) => {
  const signaling = createDirectSignaling({ signer: new PrivateKeySigner(), namespace: 'n', relays: ['ws://127.0.0.1:1'], relay: { subscribe: () => ({ close: () => undefined }), publish: async () => undefined }, iceEndpoints: [], createPeer: () => new NodePeer() });
  expect(() => signaling.send?.('nope', {}, { windowId: 'w', emit: () => undefined })).toThrow(error);
});

Then('a session with no relays to introduce it is refused with {string}', (_world: CoreWorld, error: string) => {
  const signaling = createDirectSignaling({ signer: new PrivateKeySigner(), namespace: 'n', relays: [], relay: { subscribe: () => ({ close: () => undefined }), publish: async () => undefined }, iceEndpoints: [], createPeer: () => new NodePeer() });
  expect(() => signaling.planOpen?.({ scope: { type: 'room', room: 'lobby-1234' } }, { windowId: 'w', emit: () => undefined })).toThrow(error);
});

function pool(state: Direct): RelayPool {
  const made = new RelayPool();
  state.pools.push(made);
  return made;
}

function wireWorld(state: Direct): WireWorld {
  return {
    relayUrl: state.relay.url,
    namespace: (applet) => directNamespace(summaryFor(applet)),
    createPeer: () => new NodePeer(),
    track: (closeable) => void state.peers.push(closeable),
  };
}

Given(/^"Eve" speaks the signaling herself, with a key (above|below) "([^"]+)"'s$/, async (world: CoreWorld, where: string, name: string) => {
  const state = direct(world);
  const theirs = await keyOf(person(world, name));
  state.eve = await WirePeer.make(wireWorld(state), pool(state), where === 'above' ? theirs : undefined, where === 'below' ? theirs : undefined);
});

When('{string} joins the room {string} in the applet {string}', async (world: CoreWorld, _name: string, room: string, applet: string) => {
  const eve = direct(world).eve as WirePeer;
  eve.listen(applet, room);
  await pause(200);
  await eve.hello();
});

Then('{string} sees {string} join', async (world: CoreWorld, name: string) => {
  const eve = direct(world).eve as WirePeer;
  await until(() => joined(person(world, name), eve.pubkey) > 0 && eve.channel?.readyState === 'open');
});

When('{string} sends "not json", a binary message, a message of {int} bytes and {string}', async (world: CoreWorld, _name: string, size: number, json: string) => {
  const channel = (direct(world).eve as WirePeer).channel as RTCDataChannel;
  channel.send('not json');
  channel.send(new Uint8Array([1, 2, 3]));
  channel.send(JSON.stringify('z'.repeat(size)));
  channel.send(json);
});

Then('{string} receives only {string} from {string}', async (world: CoreWorld, name: string, json: string) => {
  const who = person(world, name);
  const eve = direct(world).eve as WirePeer;
  await until(() => received(who, eve.pubkey).length > 0);
  await pause(200);
  expect(received(who, eve.pubkey)).toEqual([JSON.parse(json)]);
});

When('{string} opens a second channel {string}', (world: CoreWorld, _name: string, label: string) => {
  const eve = direct(world).eve as WirePeer;
  eve.side = (eve.connection as RTCPeerConnection).createDataChannel(label);
  eve.side.addEventListener('close', () => {
    eve.sideClosed = true;
  });
});

Then('{string} sees her second channel closed', async (world: CoreWorld) => {
  await until(() => (direct(world).eve as WirePeer).sideClosed);
});

When('{string} sends {int} messages within a second', (world: CoreWorld, _name: string, count: number) => {
  const eve = direct(world).eve as WirePeer;
  scratch(world).floodFrom = received(person(world, 'Ann'), eve.pubkey).length;
  for (let index = 0; index < count; index += 1) (eve.channel as RTCDataChannel).send(JSON.stringify({ flood: index }));
});

Then('{string} received at most {int} of them', async (world: CoreWorld, name: string, most: number) => {
  const who = person(world, name);
  const eve = direct(world).eve as WirePeer;
  const before = scratch(world).floodFrom as number;
  await until(() => received(who, eve.pubkey).length - before >= most / 2);
  await pause(500);
  expect(received(who, eve.pubkey).length - before).toBeLessThanOrEqual(most);
});

When('{string} waits a second and sends {string}', async (world: CoreWorld, _name: string, json: string) => {
  await pause(1_100);
  ((direct(world).eve as WirePeer).channel as RTCDataChannel).send(json);
});

When('{string} reloads and joins again', async (world: CoreWorld) => {
  const eve = direct(world).eve as WirePeer;
  scratch(world).oldNonce = eve.nonce;
  eve.nonce = crypto.randomUUID();
  await eve.hello();
});

Then('{string} sees {string} leave and join again', async (world: CoreWorld, name: string) => {
  const who = person(world, name);
  const eve = direct(world).eve as WirePeer;
  await until(() => events(who).some((event) => event.type === 'peer' && event.state === 'left' && event.pubkey === eve.pubkey) && joined(who, eve.pubkey) === 2);
});

When('{string} says hello as her old self', async (world: CoreWorld) => {
  const eve = direct(world).eve as WirePeer;
  await eve.signal({ type: 'hello' }, undefined, scratch(world).oldNonce as string);
});

Then('after {int} seconds {string} has seen {string} join {int} times', async (world: CoreWorld, seconds: number, name: string, _who: string, times: number) => {
  await pause(seconds * 1000);
  expect(joined(person(world, name), (direct(world).eve as WirePeer).pubkey)).toBe(times);
});

async function annNonce(world: CoreWorld, eve: WirePeer): Promise<string> {
  const ann = await keyOf(person(world, 'Ann'));
  await until(() => eve.theirs.has(ann));
  return eve.theirs.get(ann) as string;
}

When('{string} says hello in {string} asking for unreliable delivery', async (world: CoreWorld, _name: string, room: string) => {
  const eve = direct(world).eve as WirePeer;
  eve.listen('chess', room);
  await pause(200);
  await eve.signal({ type: 'hello', realtime: { profile: 'soy-rtc/realtime-1', ordered: false, maxRetransmits: 0 } });
});

When('{string} sends an offer to no one in particular', async (world: CoreWorld) => {
  await (direct(world).eve as WirePeer).signal({ type: 'offer', sdp: 'v=0' });
});

When('{string} sends {string} an offer before saying hello', async (world: CoreWorld) => {
  const eve = direct(world).eve as WirePeer;
  await eve.signal({ type: 'offer', to: await annNonce(world, eve), sdp: 'v=0' }, await keyOf(person(world, 'Ann')));
});

When('{string} sends an offer meant for someone else', async (world: CoreWorld) => {
  const eve = direct(world).eve as WirePeer;
  await eve.signal({ type: 'offer', to: 'someone', sdp: 'v=0' }, await new PrivateKeySigner().getPublicKey());
});

When('{string} sends {string} an offer that is not a session description', async (world: CoreWorld) => {
  const eve = direct(world).eve as WirePeer;
  await eve.signal({ type: 'offer', to: await annNonce(world, eve), sdp: 'this is not a session description' }, await keyOf(person(world, 'Ann')));
});

Then('{string} never answered {string}', async (world: CoreWorld, name: string) => {
  const ann = await keyOf(person(world, name));
  const eve = (direct(world).eve as WirePeer).pubkey;
  await pause(500);
  expect(direct(world).relay.published.filter((event) => event.pubkey === ann && event.tags.some((tag) => tag[0] === 'p' && tag[1] === eve))).toEqual([]);
});

Given('nine strangers with keys above {string}\'s', async (world: CoreWorld, name: string) => {
  const state = direct(world);
  const theirs = await keyOf(person(world, name));
  state.strangers = await Promise.all(Array.from({ length: 9 }, () => WirePeer.make(wireWorld(state), pool(state), theirs, undefined)));
});

When('the nine strangers say hello in {string}', async (world: CoreWorld, room: string) => {
  for (const stranger of direct(world).strangers as WirePeer[]) {
    stranger.wire = stranger.wireFor('chess', room);
    await stranger.signal({ type: 'hello' });
  }
});

async function offersTo(world: CoreWorld, key: string): Promise<number> {
  const ann = await keyOf(person(world, 'Ann'));
  return direct(world).relay.published.filter((event) => event.pubkey === ann && event.tags.some((tag) => tag[0] === 'p' && tag[1] === key)).length;
}

Then('{string} offers a connection to {int} of them, again and again', async (world: CoreWorld, _name: string, count: number) => {
  const strangers = direct(world).strangers as WirePeer[];
  const counts = async (): Promise<number[]> => Promise.all(strangers.map((stranger) => offersTo(world, stranger.pubkey)));
  await until(async () => (await counts()).filter((offers) => offers >= 2).length === count);
  expect((await counts()).filter((offers) => offers === 0)).toHaveLength(strangers.length - count);
});

When('{int} seconds pass', async (_world: CoreWorld, seconds: number) => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(Date.now() + seconds * 1000);
  await pause(2_500);
});

Then('{string} stops offering to them', async (world: CoreWorld) => {
  const strangers = direct(world).strangers as WirePeer[];
  const before = await Promise.all(strangers.map((stranger) => offersTo(world, stranger.pubkey)));
  await pause(2_500);
  expect(await Promise.all(strangers.map((stranger) => offersTo(world, stranger.pubkey)))).toEqual(before);
});

When('the ninth stranger says hello in {string} again', async (world: CoreWorld) => {
  const strangers = direct(world).strangers as WirePeer[];
  const counts = await Promise.all(strangers.map((stranger) => offersTo(world, stranger.pubkey)));
  const ninth = strangers[counts.indexOf(0)] as WirePeer;
  scratch(world).ninth = ninth;
  await ninth.signal({ type: 'hello' });
});

Then('{string} offers a connection to the ninth stranger', async (world: CoreWorld) => {
  const ninth = scratch(world).ninth as WirePeer;
  await until(async () => (await offersTo(world, ninth.pubkey)) > 0);
});

Then('after 3 seconds of hellos each has met the other once', async (world: CoreWorld) => {
  await pause(3_000);
  const [ann, ben] = [person(world, 'Ann'), person(world, 'Ben')];
  expect(joined(ann, await keyOf(ben))).toBe(1);
  expect(joined(ben, await keyOf(ann))).toBe(1);
});

When('{string} opens the room {string} open only to {string}', async (world: CoreWorld, name: string, room: string, other: string) => {
  await open(world, name, { scope: { type: 'room', room, peers: [await keyOf(person(world, other))] } });
});

Given('the relay turns signals away', (world: CoreWorld) => {
  direct(world).relay.refusing = true;
});

When('the relay takes signals again', (world: CoreWorld) => {
  direct(world).relay.refusing = false;
});

When('{string} sends a signal that is not JSON', async (world: CoreWorld) => {
  const eve = direct(world).eve as WirePeer;
  const now = Math.floor(Date.now() / 1000);
  const event = await eve.signer.signEvent({ kind: DIRECT_SIGNAL_KIND, created_at: now, content: 'not json', tags: [['d', eve.wire]] });
  await direct(world).pools[direct(world).pools.length - 1]?.publish([direct(world).relay.url], event);
});

When('{string} says hello in {string} asking for reliable delivery', async (world: CoreWorld) => {
  const eve = direct(world).eve as WirePeer;
  await eve.signal({ type: 'hello', realtime: { profile: 'soy-rtc/realtime-1', ordered: true, maxRetransmits: null } });
  await pause(300);
});

When('{string} sends {string} an answer she did not ask for', async (world: CoreWorld) => {
  const eve = direct(world).eve as WirePeer;
  await eve.signal({ type: 'answer', to: await annNonce(world, eve), sdp: 'v=0' }, await keyOf(person(world, 'Ann')));
});

When('{string} joins the room {string} in the applet {string} and offers {string} a connection twice', async (world: CoreWorld, _name: string, room: string, applet: string, other: string) => {
  const eve = direct(world).eve as WirePeer;
  eve.listen(applet, room);
  await pause(200);
  await eve.hello();
  await eve.offer(await keyOf(person(world, other)), await annNonce(world, eve), 2);
});

Then('{string} answered {string} twice with the same answer', async (world: CoreWorld) => {
  const eve = direct(world).eve as WirePeer;
  await until(() => eve.answers.length >= 2);
  expect(new Set(eve.answers).size).toBe(1);
});

Then('the rooms of an applet catalogued as {string} by {string} are kept under {string}', (_world: CoreWorld, catalogId: string, publisher: string, namespace: string) => {
  expect(directNamespace({ publisher, manifest: { catalogId } as AppletSummary['manifest'] })).toBe(namespace);
});

Then('a window that ends closes the sessions it opened, even without an approval signal', async (world: CoreWorld) => {
  const seen: WebrtcEvent[] = [];
  const signaling = createDirectSignaling({ signer: new PrivateKeySigner(), namespace: 'n', relays: [direct(world).relay.url], relay: { subscribe: () => ({ close: () => undefined }), publish: async () => undefined }, iceEndpoints: [], createPeer: () => new NodePeer() });
  await signaling.open?.({ scope: { type: 'room', room: 'lobby-1234' } }, { windowId: 'w', emit: (event) => void seen.push(event) }, { signalingRelayUrls: [], iceEndpoints: [], resource: 'room:lobby-1234' });
  signaling.destroyWindow?.('w');
  expect(seen).toEqual([expect.objectContaining({ type: 'closed' })]);
});
