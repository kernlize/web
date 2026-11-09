import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { getEventHash, kinds, type NostrEvent } from 'applesauce-core/helpers';
import { giftWrap } from 'applesauce-common/operations/gift-wrap';
import { EventStore } from 'applesauce-core';
import { PrivateKeySigner } from 'applesauce-signers';
import type { DmMessage } from '@napplet/core';
import type { MessagingBackend } from '@kernlize/messaging';
import { MarmotClient, createApplicationMessageIntent, createChatRumor } from '@internet-privacy/marmot-ts';
import { InMemoryKeyValueStore } from '@internet-privacy/marmot-ts/extra';
import { addDevice, conversationWith, device, m, person, pubkeys, send, settle } from './messaging-backends.js';
import { createGroupMessagesBackend, createGroupNetwork, createSealedGroupStore } from '@kernlize/core';
import { k } from './kernl.js';
import { MemoryStorage, scratch, type CoreWorld } from './world.js';

const GROUP_RELAYS = ['wss://outbox.example', 'wss://super.example'];

function published(world: CoreWorld, kind: number): NostrEvent[] {
  return m(world).network.published.map((entry) => entry.event).filter((event) => event.kind === kind);
}

Given('{word} sets up group sessions on {string}', async (world: CoreWorld, name: string, deviceName: string) => {
  const who = person(world, name);
  await addDevice(world, deviceName, 'group', who.signer, who.pubkey).backend.conversations();
});

When('{word} reloads group sessions on {string}', async (world: CoreWorld, name: string, deviceName: string) => {
  device(world, deviceName).backend.close?.();
  const who = person(world, name);
  await addDevice(world, deviceName, 'group', who.signer, who.pubkey).backend.conversations();
});

When('{string} replies {string} in a refused send to {string}', async (world: CoreWorld, deviceName: string, content: string, names: string) => {
  const conversation = await conversationWith(world, deviceName, names);
  await send(world, deviceName, { recipients: [], content, conversationId: conversation?.id as string });
});

When('dave starts a group with {string} from another app and sends a reaction and then {string}', async (world: CoreWorld, names: string, content: string) => {
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  m(world).people.set('dave', { signer, pubkey });
  const client = new MarmotClient({
    signer,
    network: createGroupNetwork(m(world).network, async () => GROUP_RELAYS),
    clientId: 'd'.repeat(64),
    groupStateStore: new InMemoryKeyValueStore(),
    keyPackageStore: new InMemoryKeyValueStore(),
  });
  const invited = pubkeys(world, names);
  const invitees = invited.map((member) => published(world, 30443).find((event) => event.pubkey === member) as NostrEvent);
  const group = await client.groups.create('', { relays: GROUP_RELAYS, adminPubkeys: [pubkey], invitees });
  const listening = await client.groups.connect(group.id);
  await settle(world);
  const draft = { pubkey, kind: kinds.Reaction, created_at: 1_700_000_000, tags: [], content: '+' };
  await client.groups.send(group.id, createApplicationMessageIntent({ ...draft, id: getEventHash(draft) }));
  await client.groups.send(group.id, createApplicationMessageIntent(createChatRumor({ pubkey, content })));
  await settle(world);
  listening.unsubscribe();
});

When('a rogue server sends bob an invitation that cannot be joined and a broken group event', async (world: CoreWorld) => {
  const bob = person(world, 'bob').pubkey;
  const stranger = new PrivateKeySigner();
  const invitation = await giftWrap(bob, stranger)({ kind: 444, created_at: 1_700_000_000, tags: [], content: 'not a welcome' });
  m(world).network.push(invitation);
  const tag = published(world, 445)[0]?.tags.find((entry) => entry[0] === 'h') as string[];
  m(world).network.push(await stranger.signEvent({ kind: 445, created_at: 1_700_000_000, tags: [tag], content: 'not a group event' }));
  await settle(world);
});

Then('a sealed group store forgets everything when it is cleared', async (world: CoreWorld) => {
  const who = person(world, 'alice');
  const storage = new MemoryStorage();
  const options = { storage, signer: who.signer, owner: who.pubkey };
  const store = createSealedGroupStore<Uint8Array>(options, 'scratch');
  await store.setItem('one', new Uint8Array([1, 2, 3]));
  await store.clear();
  expect(await store.keys()).toEqual([]);
  expect(await createSealedGroupStore<Uint8Array>(options, 'scratch').getItem('one')).toBeNull();
});

Then('{string}, {string} and {string} file it under one group id', async (world: CoreWorld, first: string, second: string, third: string) => {
  const ids = new Set<string>();
  for (const name of [first, second, third]) {
    const { conversations } = await device(world, name).backend.conversations();
    expect(conversations).toHaveLength(1);
    ids.add(conversations[0]?.id as string);
  }
  expect(ids.size).toBe(1);
  expect([...ids][0]).toMatch(/^[0-9a-f]{64}$/);
});

Then('the network carried a key package signed by {string} and one signed by {string}', (world: CoreWorld, first: string, second: string) => {
  const authors = published(world, 30443).map((event) => event.pubkey);
  expect(authors).toEqual(expect.arrayContaining(pubkeys(world, `${first},${second}`)));
});

Then('the network carried group events signed by nobody in the group', (world: CoreWorld) => {
  const people = pubkeys(world, 'alice,bob,carol');
  const events = published(world, 445);
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((event) => !people.includes(event.pubkey))).toBe(true);
  expect(published(world, 1059).length).toBeGreaterThan(0);
});

Then('no event on the network contains {string}', (world: CoreWorld, text: string) => {
  expect(JSON.stringify(m(world).network.published)).not.toContain(text);
});

Then('exactly one of {string} and {string} has a conversation with {string}', async (world: CoreWorld, first: string, second: string, names: string) => {
  const found = await Promise.all([first, second].map((name) => conversationWith(world, name, names)));
  expect(found.filter(Boolean)).toHaveLength(1);
});

Then('{string} has {int} conversations', async (world: CoreWorld, deviceName: string, count: number) => {
  expect((await device(world, deviceName).backend.conversations()).conversations).toHaveLength(count);
});

Then('everything {string} stored is sealed to {word}', async (world: CoreWorld, deviceName: string, name: string) => {
  const { storage } = device(world, deviceName);
  const who = person(world, name);
  expect(storage.length).toBeGreaterThan(0);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index) as string;
    expect(key.startsWith(`kernl:group:v1:${who.pubkey}:`)).toBe(true);
    const parts = JSON.parse(storage.getItem(key) as string) as string[];
    const opened = await Promise.all(parts.map((part) => who.signer.nip44.decrypt(who.pubkey, part)));
    expect(JSON.parse(opened.join(''))).toBeTypeOf('object');
    expect(parts.join('')).not.toContain('$bytes');
  }
});

const WAIT = { timeout: 8000, interval: 20 };

interface GroupCorrespondent {
  readonly pubkey: string;
  readonly backend: MessagingBackend;
  conversationId?: string;
}

function dmBob(world: CoreWorld): GroupCorrespondent {
  return scratch(world).dmGroupBob as GroupCorrespondent;
}

function dmResults(world: CoreWorld, type: string): Record<string, unknown>[] {
  return k(world).received.filter((entry) => entry.type === type);
}

async function ask(world: CoreWorld, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const type = request.type as string;
  const before = dmResults(world, `${type}.result`).length;
  k(world).channel?.port1.postMessage({ id: `${type}-${before + 1}`, ...request });
  await vi.waitFor(() => expect(dmResults(world, `${type}.result`)).toHaveLength(before + 1), WAIT);
  return dmResults(world, `${type}.result`)[before] as Record<string, unknown>;
}

Given('bob opens group sessions on the same relays', async (world: CoreWorld) => {
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  const kernl = k(world).kernl;
  const backend = createGroupMessagesBackend({
    store: new EventStore(),
    pool: kernl.pool,
    tiers: kernl.relays,
    storage: new MemoryStorage(),
    signer: () => signer,
    selfPubkey: () => pubkey,
  });
  await backend.conversations();
  scratch(world).dmGroupBob = { pubkey, backend } satisfies GroupCorrespondent;
});

When('the applet asks for its message status over its port', async (world: CoreWorld) => {
  expect(JSON.stringify(await ask(world, { type: 'dm.status' }))).toContain('marmot');
});

Then('the applet\'s sent message is filed under a {string} group', (world: CoreWorld, provider: string) => {
  const result = dmResults(world, 'dm.send.result')[0];
  const message = result?.message as DmMessage;
  expect(result?.error).toBeUndefined();
  expect(message.id.startsWith(`${provider}:`)).toBe(true);
  expect(message.conversationId).toMatch(new RegExp(`^${provider}:[0-9a-f]{64}$`));
  dmBob(world).conversationId = message.conversationId;
});

Then('bob reads {string} in his group with the shell\'s account', async (world: CoreWorld, content: string) => {
  const self = k(world).kernl.accounts.active?.pubkey;
  await vi.waitFor(async () => {
    const [conversation] = (await dmBob(world).backend.conversations()).conversations;
    expect(`group:${conversation?.id}`).toBe(dmBob(world).conversationId);
    const page = await dmBob(world).backend.messages({ conversationId: conversation?.id as string });
    expect(page.messages.at(-1)).toMatchObject({ content, status: 'received', senderPubkey: self });
  }, WAIT);
});

When('bob replies {string} in that group', async (world: CoreWorld, content: string) => {
  const conversationId = (dmBob(world).conversationId as string).slice('group:'.length);
  await dmBob(world).backend.send({ recipients: [], content, conversationId });
});

Then('the applet is pushed {string} in that group', async (world: CoreWorld, content: string) => {
  await vi.waitFor(() => {
    const pushed = dmResults(world, 'dm.message').map((entry) => entry.message as DmMessage);
    expect(pushed.find((message) => message.content === content)).toMatchObject({ conversationId: dmBob(world).conversationId, senderPubkey: dmBob(world).pubkey });
  }, WAIT);
});

Then('the applet lists that group among its conversations over its port', async (world: CoreWorld) => {
  const result = await ask(world, { type: 'dm.conversations' });
  const ids = (result.conversations as { id: string }[]).map((conversation) => conversation.id);
  expect(ids).toContain(dmBob(world).conversationId);
});

When('the applet reads that group over its port', async (world: CoreWorld) => {
  await ask(world, { type: 'dm.messages', conversationId: dmBob(world).conversationId });
});

Then('bob closes his group sessions', (world: CoreWorld) => {
  dmBob(world).backend.close?.();
});

When('the applet sends {string} to bob in a new group over its port', async (world: CoreWorld, content: string) => {
  await ask(world, { type: 'dm.send', recipients: [dmBob(world).pubkey], content, provider: 'group' });
});
