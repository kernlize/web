import { expect, vi } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import { Subject } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { kinds, verifyEvent, type NostrEvent } from 'applesauce-core/helpers';
import { giftWrap } from 'applesauce-common/operations/gift-wrap';
import { LegacyMessageFactory } from 'applesauce-common/factories/legacy-message';
import { createConversationIdentifier } from 'applesauce-common/helpers/messages';
import { PrivateKeySigner, type ISigner } from 'applesauce-signers';
import { ReadonlyAccount } from 'applesauce-accounts/accounts';
import type { DmConversation, DmMessage, DmSendResult } from '@napplet/core';
import type { MessagingBackend } from '@kernl/messaging';
import {
  createGroupMessagesBackend,
  createLegacyMessagesBackend,
  createPrivateMessagesBackend,
  createRelayTiers,
  messagingSigner,
  signerAvailability,
  type SignerMessagingOptions,
} from '@kernl/core';
import { createRelayNetwork, type RelayNetwork } from './relay-network.js';
import { MemoryStorage, passwordAccount, scratch, splitList, type CoreWorld } from './world.js';

const DISCOVERY = 'wss://discovery.example';
const TIERS = { discovery: [DISCOVERY], apps: [], outbox: ['wss://outbox.example'], super: ['wss://super.example'] };

export interface Device {
  readonly backend: MessagingBackend;
  /** What the device keeps between page loads; a device added again under the same name keeps it. */
  readonly storage: MemoryStorage;
  readonly store: EventStore;
  readonly changes: Subject<void>;
  signer: ISigner | undefined;
  pubkey: string | undefined;
}

export interface MessagingScratch {
  readonly network: RelayNetwork;
  readonly storages: Map<string, MemoryStorage>;
  readonly people: Map<string, { signer: PrivateKeySigner; pubkey: string }>;
  readonly devices: Map<string, Device>;
  readonly subscriptions: Map<string, { device: string; id: string; seen: DmMessage[] }>;
  sendError?: Error;
  lastSend?: DmSendResult;
}

export function m(world: CoreWorld): MessagingScratch {
  return scratch(world).messagingBackends as MessagingScratch;
}

export function person(world: CoreWorld, name: string): { signer: PrivateKeySigner; pubkey: string } {
  const found = m(world).people.get(name);
  if (!found) throw new Error(`unknown person ${name}`);
  return found;
}

export function pubkeys(world: CoreWorld, names: string): string[] {
  return splitList(names).map((name) => person(world, name).pubkey);
}

export function device(world: CoreWorld, name: string): Device {
  const found = m(world).devices.get(name);
  if (!found) throw new Error(`unknown device ${name}`);
  return found;
}

/** Wait until every device has opened what already arrived. */
export async function settle(world: CoreWorld): Promise<void> {
  for (const entry of m(world).devices.values()) await entry.backend.conversations();
}

export function addDevice(world: CoreWorld, name: string, kind: string, signer: ISigner | undefined, pubkey: string | undefined): Device {
  let clock = 1_700_000_000;
  const store = new EventStore();
  const changes = new Subject<void>();
  const storage = m(world).storages.get(name) ?? new MemoryStorage();
  m(world).storages.set(name, storage);
  const entry = { store, changes, signer, pubkey, storage } as Device;
  const options: SignerMessagingOptions = {
    store,
    pool: m(world).network,
    tiers: createRelayTiers(new MemoryStorage(), TIERS),
    signer: () => entry.signer,
    selfPubkey: () => entry.pubkey,
    now: () => (clock += 10),
    accountChanges: changes,
  };
  const backends: Record<string, () => MessagingBackend> = {
    legacy: () => createLegacyMessagesBackend(options),
    private: () => createPrivateMessagesBackend(options),
    group: () => createGroupMessagesBackend({ ...options, storage }),
  };
  const backend = (backends[kind] as () => MessagingBackend)();
  m(world).devices.set(name, Object.assign(entry, { backend }));
  return entry;
}

export async function send(world: CoreWorld, name: string, request: { recipients: string[]; content: string; conversationId?: string }): Promise<void> {
  m(world).sendError = undefined;
  try {
    m(world).lastSend = await device(world, name).backend.send(request);
  } catch (error) {
    m(world).sendError = error as Error;
  }
  await settle(world);
}

export async function conversationWith(world: CoreWorld, name: string, others: string): Promise<DmConversation | undefined> {
  const expected = pubkeys(world, others).sort();
  const page = await device(world, name).backend.conversations();
  return page.conversations.find((conversation) => JSON.stringify(conversation.participants.map((peer) => peer.pubkey).sort()) === JSON.stringify(expected));
}

Given('a message network with alice, bob and carol', async (world: CoreWorld) => {
  const people = new Map<string, { signer: PrivateKeySigner; pubkey: string }>();
  for (const name of ['alice', 'bob', 'carol']) {
    const signer = new PrivateKeySigner();
    people.set(name, { signer, pubkey: await signer.getPublicKey() });
  }
  scratch(world).messagingBackends = { network: createRelayNetwork(), people, devices: new Map(), storages: new Map(), subscriptions: new Map() } satisfies MessagingScratch;
});

Given('{word} uses the {word} backend on {string}', (world: CoreWorld, name: string, kind: string, deviceName: string) => {
  const who = person(world, name);
  addDevice(world, deviceName, kind, who.signer, who.pubkey);
});

Given('{string} runs the {word} backend with {}', async (world: CoreWorld, deviceName: string, kind: string, description: string) => {
  const key = new PrivateKeySigner();
  const base = { getPublicKey: () => key.getPublicKey(), signEvent: (template: Parameters<ISigner['signEvent']>[0]) => key.signEvent(template) };
  const signers: Record<string, ISigner | undefined> = {
    'nobody signed in': undefined,
    'a signer without encryption': base,
    'a signer with only nip04': { ...base, nip04: key.nip04 },
    'a signer with only nip44': { ...base, nip44: key.nip44 },
    'a signer but no public key': key,
  };
  const signer = signers[description];
  const pubkey = signer && description !== 'a signer but no public key' ? await key.getPublicKey() : undefined;
  addDevice(world, deviceName, kind, signer, pubkey);
});

Given('{word} lists {string} as his message inbox', async (world: CoreWorld, name: string, relay: string) => {
  const list = await person(world, name).signer.signEvent({ kind: kinds.DirectMessageRelaysList, created_at: 1_700_000_000, tags: [['relay', relay]], content: '' });
  await m(world).network.publish([DISCOVERY], list);
  m(world).network.published.length = 0;
});

Given('{string} already holds {word}\'s message inbox {string}', async (world: CoreWorld, deviceName: string, name: string, relay: string) => {
  const list = await person(world, name).signer.signEvent({ kind: kinds.DirectMessageRelaysList, created_at: 1_700_000_000, tags: [['relay', relay]], content: '' });
  device(world, deviceName).store.add(list);
});

Given('the network refuses lookups', (world: CoreWorld) => {
  m(world).network.refuseLookups = true;
});

Given('the network refuses publishes', (world: CoreWorld) => {
  m(world).network.refusePublishes = true;
});

When('{string} sends {string} to {string}', async (world: CoreWorld, deviceName: string, content: string, names: string) => {
  await send(world, deviceName, { recipients: pubkeys(world, names), content });
});

When('{string} sends {string} to the raw recipients {string}', async (world: CoreWorld, deviceName: string, content: string, raw: string) => {
  await send(world, deviceName, { recipients: splitList(raw), content });
});

When('{string} sends {string} into the conversation of {string}', async (world: CoreWorld, deviceName: string, content: string, names: string) => {
  await send(world, deviceName, { recipients: [], content, conversationId: createConversationIdentifier(pubkeys(world, names)) });
});

When('{string} replies {string} in its conversation with {string}', async (world: CoreWorld, deviceName: string, content: string, names: string) => {
  const conversation = await conversationWith(world, deviceName, names);
  await send(world, deviceName, { recipients: [], content, conversationId: conversation?.id as string });
  expect(m(world).sendError).toBeUndefined();
});

Then('the last send was refused with {string}', (world: CoreWorld, reason: string) => {
  expect(m(world).sendError?.message).toBe(reason);
});

Then('the network carried {int} wraps of kind 1059 under keys that belong to nobody and differ per wrap', (world: CoreWorld, count: number) => {
  const wraps = m(world).network.published.map((entry) => entry.event);
  expect(wraps).toHaveLength(count);
  expect(wraps.every((wrap) => wrap.kind === 1059 && verifyEvent(wrap))).toBe(true);
  const people = [...m(world).people.values()].map((entry) => entry.pubkey);
  expect(wraps.some((wrap) => people.includes(wrap.pubkey))).toBe(false);
  expect(new Set(wraps.map((wrap) => wrap.pubkey)).size).toBe(count);
});

Then('every wrap opens to a seal signed by {word}', async (world: CoreWorld, name: string) => {
  const byKey = new Map([...m(world).people.values()].map((entry) => [entry.pubkey, entry.signer]));
  for (const { event } of m(world).network.published) {
    const addressee = byKey.get(event.tags.find((tag) => tag[0] === 'p')?.[1] as string) as PrivateKeySigner;
    const seal = JSON.parse(await addressee.nip44.decrypt(event.pubkey, event.content)) as NostrEvent;
    expect(seal.kind).toBe(13);
    expect(verifyEvent(seal)).toBe(true);
    expect(seal.pubkey).toBe(person(world, name).pubkey);
  }
});

Then('the wraps went to {string} and to {string}', (world: CoreWorld, first: string, second: string) => {
  const addressed = m(world).network.published.map((entry) => entry.event.tags.find((tag) => tag[0] === 'p')?.[1]);
  expect(addressed).toEqual(pubkeys(world, `${first},${second}`));
});

Then('the network carried {int} events of kind 4 signed by {word}', (world: CoreWorld, count: number, name: string) => {
  const events = m(world).network.published.map((entry) => entry.event);
  expect(events).toHaveLength(count);
  expect(events.every((event) => event.kind === 4 && event.pubkey === person(world, name).pubkey && event.content !== 'the old way')).toBe(true);
});

Then('the wrap to {string} went to {string}', (world: CoreWorld, name: string, relays: string) => {
  const target = person(world, name).pubkey;
  const entry = m(world).network.published.find((item) => item.event.tags.some((tag) => tag[0] === 'p' && tag[1] === target));
  expect(entry?.relays).toEqual(splitList(relays));
});

Then('{string} shows a {word} conversation with {string} ending in {string} as {string}', async (world: CoreWorld, deviceName: string, kind: string, names: string, content: string, status: string) => {
  await settle(world);
  const conversation = await conversationWith(world, deviceName, names);
  expect(conversation?.kind).toBe(kind);
  const thread = await device(world, deviceName).backend.messages({ conversationId: conversation?.id as string });
  expect(thread.messages.at(-1)).toMatchObject({ content, status, conversationId: conversation?.id });
});

Then('{string} and {string} use the conversation id of {string}', async (world: CoreWorld, first: string, second: string, names: string) => {
  const expected = createConversationIdentifier(pubkeys(world, names));
  for (const name of [first, second]) {
    const ids = (await device(world, name).backend.conversations()).conversations.map((conversation) => conversation.id);
    expect(ids).toContain(expected);
  }
});

Then('{string} holds {int} messages with {string} and {int} unread', async (world: CoreWorld, deviceName: string, count: number, names: string, unread: number) => {
  const conversation = await conversationWith(world, deviceName, names);
  expect(conversation?.unread).toBe(unread);
  expect((await device(world, deviceName).backend.messages({ conversationId: conversation?.id as string })).messages).toHaveLength(count);
});

Then('{string} has no conversations', async (world: CoreWorld, deviceName: string) => {
  await settle(world);
  expect((await device(world, deviceName).backend.conversations()).conversations).toEqual([]);
});

Then('{string} reports itself {}', async (world: CoreWorld, deviceName: string, expected: string) => {
  const status = await device(world, deviceName).backend.status();
  expect(status.available).toBe(expected.startsWith('available'));
  expect(status.ownerPubkey !== undefined).toBe(expected.endsWith('for the owner'));
  expect(status.capabilities).toEqual(['send', 'receive', 'subscribe', 'history']);
});

Then('a send from {string} is refused with {string}', async (world: CoreWorld, deviceName: string, reason: string) => {
  await send(world, deviceName, { recipients: pubkeys(world, 'bob'), content: 'hi' });
  expect(m(world).sendError?.message).toBe(reason);
  expect((await device(world, deviceName).backend.conversations()).conversations).toEqual([]);
});

Then('a read-only account offers a signer that cannot encrypt', async (world: CoreWorld) => {
  const account = ReadonlyAccount.fromPubkey(person(world, 'alice').pubkey);
  const signer = messagingSigner(account);
  expect(signerAvailability(signer, 'nip44')).toEqual({ available: false, reason: 'signer-cannot-encrypt' });
  expect(await signer?.getPublicKey()).toBe(person(world, 'alice').pubkey);
  await expect(signer?.signEvent({ kind: 1, created_at: 0, tags: [], content: '' })).rejects.toThrow();
});

Then('no account offers no signer and a signing account offers itself', async () => {
  expect(messagingSigner(undefined)).toBeUndefined();
  const account = await passwordAccount('signer');
  expect(messagingSigner(account)).toBe(account);
});

async function rogueEvent(world: CoreWorld, description: string): Promise<NostrEvent> {
  const alice = person(world, 'alice').signer;
  const bob = person(world, 'bob').pubkey;
  const carol = person(world, 'carol').pubkey;
  const rumor = (kind: number, to: string, content: string) => ({ kind, created_at: 1_700_000_000, tags: [['p', to]], content });
  const stranger = new PrivateKeySigner();
  const makers: Record<string, () => Promise<NostrEvent>> = {
    'a note addressed to bob': () => alice.signEvent(rumor(1, bob, 'note')),
    'a wrap addressed to carol': () => giftWrap(carol, alice)(rumor(14, carol, 'for carol')),
    'a wrap for bob with a broken id': async () => ({ ...(await giftWrap(bob, alice)(rumor(14, bob, 'x'))), id: '0'.repeat(64) }),
    'a wrap for bob that does not decrypt': () => stranger.signEvent({ kind: 1059, created_at: 1_700_000_000, tags: [['p', bob]], content: 'not encrypted' }),
    'a wrap for bob around a note': () => giftWrap(bob, alice)(rumor(1, bob, 'note')),
    'a message from alice wrapped for bob': () => giftWrap(bob, alice)(rumor(14, bob, 'pushed')),
    'a legacy message to bob with no text': () => alice.signEvent(rumor(4, bob, '')),
    'a legacy message to bob with a broken id': async () => ({ ...(await LegacyMessageFactory.create(bob, 'x').sign(alice)), id: '0'.repeat(64) }),
    'a legacy message between alice and carol': () => LegacyMessageFactory.create(carol, 'not yours').sign(alice),
    'a legacy message to bob that does not decrypt': () => alice.signEvent(rumor(4, bob, 'plain text')),
  };
  return (makers[description] as () => Promise<NostrEvent>)();
}

When('a rogue server pushes these to everyone:', async (world: CoreWorld, table: DataTable) => {
  await settle(world);
  for (const [description] of table.raw()) m(world).network.push(await rogueEvent(world, description as string));
  await settle(world);
});

When('{string} subscribes to everything as {string}', async (world: CoreWorld, deviceName: string, label: string) => {
  const seen: DmMessage[] = [];
  const { subscriptionId } = await device(world, deviceName).backend.subscribe({}, (message) => seen.push(message));
  m(world).subscriptions.set(label, { device: deviceName, id: subscriptionId, seen });
});

When('{string} subscribes to its conversation with {string} as {string}', async (world: CoreWorld, deviceName: string, names: string, label: string) => {
  const seen: DmMessage[] = [];
  const conversationId = createConversationIdentifier([device(world, deviceName).pubkey as string, ...pubkeys(world, names)]);
  const { subscriptionId } = await device(world, deviceName).backend.subscribe({ conversationId }, (message) => seen.push(message));
  m(world).subscriptions.set(label, { device: deviceName, id: subscriptionId, seen });
});

function subscription(world: CoreWorld, label: string): { device: string; id: string; seen: DmMessage[] } {
  return m(world).subscriptions.get(label) as { device: string; id: string; seen: DmMessage[] };
}

Then('subscription {string} saw {string}', async (world: CoreWorld, label: string, contents: string) => {
  await settle(world);
  expect(subscription(world, label).seen.map((message) => message.content)).toEqual(splitList(contents));
});

Then('subscription {string} saw nothing', async (world: CoreWorld, label: string) => {
  await settle(world);
  expect(subscription(world, label).seen).toEqual([]);
});

When('subscription {string} is cancelled', async (world: CoreWorld, label: string) => {
  const entry = subscription(world, label);
  expect(await device(world, entry.device).backend.unsubscribe(entry.id)).toEqual({ ok: true });
});

Then('cancelling subscription {string} again reports false', async (world: CoreWorld, label: string) => {
  const entry = subscription(world, label);
  expect(await device(world, entry.device).backend.unsubscribe(entry.id)).toEqual({ ok: false });
});

function inboxSubscriptions(world: CoreWorld, name: string): LiveReq[] {
  const pubkey = person(world, name).pubkey;
  return [...m(world).network.live].filter((entry) => entry.filters.some((filter) => filter['#p']?.includes(pubkey)));
}

Then('{string} listens on {string}', async (world: CoreWorld, deviceName: string, relays: string) => {
  await settle(world);
  const owner = [...m(world).people].find(([, entry]) => entry.pubkey === device(world, deviceName).pubkey)?.[0] as string;
  expect(inboxSubscriptions(world, owner).map((entry) => entry.relays)).toEqual([splitList(relays)]);
});

Then('the network holds {int} inbox subscriptions for {word} and {int} for {word}', (world: CoreWorld, first: number, a: string, second: number, b: string) => {
  expect(inboxSubscriptions(world, a)).toHaveLength(first);
  expect(inboxSubscriptions(world, b)).toHaveLength(second);
});

Then('{string} pages conversations one at a time as {string}', async (world: CoreWorld, deviceName: string, names: string) => {
  const { backend } = device(world, deviceName);
  const first = await backend.conversations({ limit: 1 });
  const second = await backend.conversations({ limit: 1, ...(first.cursor === undefined ? {} : { cursor: first.cursor }) });
  expect(second.cursor).toBeUndefined();
  const order = [...first.conversations, ...second.conversations].map((conversation) => conversation.participants[0]?.pubkey);
  expect(order).toEqual(pubkeys(world, names));
});

Then('{string} pages its messages with {string} one at a time as {string}', async (world: CoreWorld, deviceName: string, names: string, contents: string) => {
  const { backend } = device(world, deviceName);
  const conversationId = (await conversationWith(world, deviceName, names))?.id as string;
  const first = await backend.messages({ conversationId, limit: 1 });
  const second = await backend.messages({ conversationId, limit: 1, ...(first.cursor === undefined ? {} : { cursor: first.cursor }) });
  expect(second.cursor).toBeUndefined();
  expect([...first.messages, ...second.messages].map((message) => message.content)).toEqual(splitList(contents));
  expect(await backend.messages({ conversationId: 'nobody' })).toEqual({ messages: [] });
});

Then('{string} treats an unreadable cursor as the start', async (world: CoreWorld, deviceName: string) => {
  const { backend } = device(world, deviceName);
  expect(await backend.conversations({ cursor: 'nonsense' })).toEqual(await backend.conversations());
});

function switchTo(world: CoreWorld, deviceName: string, name: string | undefined): Device {
  const entry = device(world, deviceName);
  const who = name === undefined ? undefined : person(world, name);
  entry.signer = who?.signer;
  entry.pubkey = who?.pubkey;
  return entry;
}

When('{string} switches to {word}', (world: CoreWorld, deviceName: string, name: string) => {
  switchTo(world, deviceName, name);
});

When('{string} switches to {word} and announces it', async (world: CoreWorld, deviceName: string, name: string) => {
  switchTo(world, deviceName, name).changes.next();
  await vi.waitFor(() => expect(inboxSubscriptions(world, name)).toHaveLength(1));
});

When('{string} signs out', (world: CoreWorld, deviceName: string) => {
  switchTo(world, deviceName, undefined);
});

When('{string} sends {string} to {string} and {string} switches to {word} at once', async (world: CoreWorld, sender: string, content: string, names: string, deviceName: string, name: string) => {
  await device(world, deviceName).backend.conversations();
  let switching: Promise<unknown> = Promise.resolve();
  m(world).network.afterPublish = () => {
    m(world).network.afterPublish = undefined;
    switchTo(world, deviceName, name);
    switching = device(world, deviceName).backend.conversations();
  };
  await device(world, sender).backend.send({ recipients: pubkeys(world, names), content });
  await switching;
});

When('{string} starts reading and switches to {word} before the inbox opens', async (world: CoreWorld, deviceName: string, name: string) => {
  const reading = device(world, deviceName).backend.conversations();
  switchTo(world, deviceName, name);
  await device(world, deviceName).backend.conversations();
  await reading;
});

When('{string} is closed', (world: CoreWorld, deviceName: string) => {
  device(world, deviceName).backend.close?.();
});
