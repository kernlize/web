import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { PrivateKeySigner } from 'applesauce-signers';
import type { DmMessage } from '@napplet/core';
import type { MessagingBackend } from '@kernl/messaging';
import { createRatchetMessagesBackend, messagingSigner, type Kernl } from '@kernl/core';
import { blobFetcher, boot, k } from './kernl.js';
import { createRelayNetwork } from './relay-network.js';
import { MemoryStorage, scratch, type CoreWorld } from './world.js';

/** Short device-list discovery so session setup fits a scenario; production keeps the library's defaults. */
const DISCOVERY = { fetchMs: 60, fastMs: 30 };
const WAIT = { timeout: 4000, interval: 20 };

interface Correspondent {
  readonly pubkey: string;
  readonly backend: MessagingBackend;
}

function bob(world: CoreWorld): Correspondent {
  return scratch(world).dmBob as Correspondent;
}

function self(world: CoreWorld): string {
  return k(world).kernl.accounts.active?.pubkey as string;
}

function chatId(world: CoreWorld): string {
  return [self(world), bob(world).pubkey].sort().join(':');
}

function ratchetFor(kernl: () => Kernl, storage: MemoryStorage): MessagingBackend {
  return createRatchetMessagesBackend({
    pool: kernl().pool,
    tiers: kernl().relays,
    storage,
    signer: () => messagingSigner(kernl().accounts.active),
    selfPubkey: () => kernl().accounts.active?.pubkey,
    accountChanges: kernl().accounts.active$,
    discoveryTimeouts: DISCOVERY,
  });
}

function received(world: CoreWorld, type: string): Record<string, unknown>[] {
  return k(world).received.filter((entry) => entry.type === type);
}

Given('a kernl shell over a message network serving that manifest', (world: CoreWorld) => {
  const network = createRelayNetwork();
  network.everywhere.push(scratch(world).manifest.event);
  scratch(world).pool = network as never;
  const storage = new MemoryStorage();
  boot(world, { messagingBackends: { ratchet: () => ratchetFor(() => k(world).kernl, storage) } }, blobFetcher(world));
});

Given('bob opens ratchet sessions on the same relays', async (world: CoreWorld) => {
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  const kernl = k(world).kernl;
  const backend = createRatchetMessagesBackend({
    pool: kernl.pool,
    tiers: kernl.relays,
    storage: new MemoryStorage(),
    signer: () => signer,
    selfPubkey: () => pubkey,
    discoveryTimeouts: DISCOVERY,
  });
  await backend.conversations();
  scratch(world).dmBob = { pubkey, backend } satisfies Correspondent;
});

When('the shell enables messaging provider {string}', (world: CoreWorld, id: string) => {
  k(world).kernl.messaging.enable(id);
});

When('the applet subscribes to its messages over its port', async (world: CoreWorld) => {
  k(world).channel?.port1.postMessage({ type: 'dm.subscribe', id: 'dm.subscribe-1' });
  await vi.waitFor(() => expect(received(world, 'dm.subscribe.result')).toHaveLength(1), WAIT);
});

When('the applet sends {string} to bob with provider {string} over its port', async (world: CoreWorld, content: string, provider: string) => {
  k(world).channel?.port1.postMessage({ type: 'dm.send', id: 'dm.send-1', recipients: [bob(world).pubkey], content, provider });
  await vi.waitFor(() => expect(received(world, 'dm.send.result')).toHaveLength(1), WAIT);
});

Then('the applet\'s sent message is namespaced {string}', (world: CoreWorld, provider: string) => {
  const result = received(world, 'dm.send.result')[0];
  const message = result?.message as DmMessage;
  expect(result?.error).toBeUndefined();
  expect(message.id.startsWith(`${provider}:`)).toBe(true);
  expect(message.conversationId).toBe(`${provider}:${chatId(world)}`);
  expect(message.status).toBe('sent');
});

Then('bob reads {string} from the shell\'s account', async (world: CoreWorld, content: string) => {
  await vi.waitFor(async () => {
    const page = await bob(world).backend.messages({ conversationId: chatId(world) });
    expect(page.messages.at(-1)).toMatchObject({ content, status: 'received', senderPubkey: self(world) });
  }, WAIT);
});

When('bob replies {string} to the shell\'s account', async (world: CoreWorld, content: string) => {
  await bob(world).backend.send({ recipients: [self(world)], content });
});

Then('the applet is pushed {string} namespaced {string}', async (world: CoreWorld, content: string, provider: string) => {
  await vi.waitFor(() => {
    const pushed = received(world, 'dm.message').map((entry) => entry.message as DmMessage);
    expect(pushed.find((message) => message.content === content)).toMatchObject({ conversationId: `${provider}:${chatId(world)}`, senderPubkey: bob(world).pubkey });
  }, WAIT);
});

When('the applet reads its {string} conversation with bob over its port', async (world: CoreWorld, provider: string) => {
  k(world).channel?.port1.postMessage({ type: 'dm.messages', id: 'dm.messages-1', conversationId: `${provider}:${chatId(world)}` });
  await vi.waitFor(() => expect(received(world, 'dm.messages.result')).toHaveLength(1), WAIT);
});

Then('the applet\'s page holds {string} with every id namespaced {string}', (world: CoreWorld, contents: string, provider: string) => {
  const messages = received(world, 'dm.messages.result')[0]?.messages as DmMessage[];
  expect(messages.map((message) => message.content)).toEqual(contents.split('|'));
  for (const message of messages) expect(message.id.startsWith(`${provider}:`)).toBe(true);
});

Then('bob closes his ratchet sessions', (world: CoreWorld) => {
  bob(world).backend.close?.();
});
