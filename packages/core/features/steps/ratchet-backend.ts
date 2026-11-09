import { expect, vi } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { Subject } from 'rxjs';
import { PrivateKeySigner, type ISigner } from 'applesauce-signers';
import { ReadonlyAccount } from 'applesauce-accounts/accounts';
import type { DmMessage } from '@napplet/core';
import type { MessagingBackend, MessagingRegistry } from '@kernlize/messaging';
import {
  createDefaultMessaging,
  createRatchetMessagesBackend,
  createRelayTiers,
  createSealedRatchetStorage,
  messagingSigner,
} from '@kernlize/core';
import type { StorageAdapter } from 'nostr-double-ratchet';
import { createRelayNetwork, type RelayNetwork } from './relay-network.js';
import { MemoryStorage, scratch, splitList, type CoreWorld } from './world.js';

const TIERS = { discovery: ['wss://discovery.example'], apps: [], outbox: ['wss://outbox.example'], super: ['wss://super.example'] };
/** Session setup crosses several relay round trips and timers inside the library. */
const WAIT = { timeout: 4000, interval: 20 };

interface RatchetDevice {
  backend: MessagingBackend;
  readonly storage: MemoryStorage;
  readonly changes: Subject<void>;
  signer: ISigner | undefined;
  pubkey: string | undefined;
  readonly seen: DmMessage[];
  registry?: MessagingRegistry;
}

interface RatchetScratch {
  readonly network: RelayNetwork;
  readonly people: Map<string, { signer: PrivateKeySigner; pubkey: string }>;
  readonly devices: Map<string, RatchetDevice>;
  sealed?: { storage: MemoryStorage; adapter: StorageAdapter };
}

function r(world: CoreWorld): RatchetScratch {
  return scratch(world).ratchet as RatchetScratch;
}

function person(world: CoreWorld, name: string): { signer: PrivateKeySigner; pubkey: string } {
  const found = r(world).people.get(name);
  if (!found) throw new Error(`unknown person ${name}`);
  return found;
}

function device(world: CoreWorld, name: string): RatchetDevice {
  const found = r(world).devices.get(name);
  if (!found) throw new Error(`unknown device ${name}`);
  return found;
}

function backendOn(world: CoreWorld, entry: Omit<RatchetDevice, 'backend'>): MessagingBackend {
  return createRatchetMessagesBackend({
    pool: r(world).network,
    tiers: createRelayTiers(new MemoryStorage(), TIERS),
    storage: entry.storage,
    signer: () => entry.signer,
    selfPubkey: () => entry.pubkey,
    accountChanges: entry.changes,
    discoveryTimeouts: { fetchMs: 60, fastMs: 30 },
  });
}

function addDevice(world: CoreWorld, name: string, who?: string): RatchetDevice {
  const owner = who === undefined ? undefined : person(world, who);
  const entry = { storage: new MemoryStorage(), changes: new Subject<void>(), signer: owner?.signer as ISigner | undefined, pubkey: owner?.pubkey, seen: [] };
  const created: RatchetDevice = Object.assign(entry, { backend: backendOn(world, entry) });
  r(world).devices.set(name, created);
  return created;
}

function pubkeysOf(world: CoreWorld, names: string): string[] {
  return splitList(names).map((name) => person(world, name).pubkey);
}

async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  return 'no error';
}

After((world: CoreWorld) => {
  for (const entry of (scratch(world).ratchet as RatchetScratch | undefined)?.devices.values() ?? []) {
    entry.backend.close?.();
    entry.registry?.close();
  }
});

Given('a ratchet network with alice, bob and carol', async (world: CoreWorld) => {
  const people = new Map<string, { signer: PrivateKeySigner; pubkey: string }>();
  for (const name of ['alice', 'bob', 'carol']) {
    const signer = new PrivateKeySigner();
    people.set(name, { signer, pubkey: await signer.getPublicKey() });
  }
  scratch(world).ratchet = { network: createRelayNetwork(), people, devices: new Map() } satisfies RatchetScratch;
});

Given('{word} opens ratchet sessions on {string}', async (world: CoreWorld, who: string, name: string) => {
  await addDevice(world, name, who).backend.conversations();
});

Given('{word} opens ratchet sessions on {string} while the network refuses everything', (world: CoreWorld, who: string, name: string) => {
  r(world).network.refusePublishes = true;
  r(world).network.refuseLookups = true;
  addDevice(world, name, who);
});

When('the account on {string} announces a change', async (world: CoreWorld, name: string) => {
  device(world, name).changes.next();
  await new Promise((resolve) => setTimeout(resolve, 400));
});

When('the network accepts again', (world: CoreWorld) => {
  r(world).network.refusePublishes = false;
  r(world).network.refuseLookups = false;
});

Given('a ratchet backend on {string} with nobody signed in', (world: CoreWorld, name: string) => {
  addDevice(world, name);
});

When('{string} watches its ratchet messages', async (world: CoreWorld, name: string) => {
  const entry = device(world, name);
  await entry.backend.subscribe({}, (message) => entry.seen.push(message));
  await entry.backend.subscribe({ conversationId: 'elsewhere' }, (message) => entry.seen.push(message));
  const other = await entry.backend.subscribe({}, (message) => entry.seen.push(message));
  expect(await entry.backend.unsubscribe(other.subscriptionId)).toEqual({ ok: true });
});

When('{string} sends {string} to {string} over ratchet', async (world: CoreWorld, name: string, text: string, to: string) => {
  const result = await device(world, name).backend.send({ recipients: pubkeysOf(world, to), content: text });
  expect(result.message?.status).toBe('sent');
});

When('{string} replies {string} in its ratchet conversation with {string}', async (world: CoreWorld, name: string, text: string, other: string) => {
  const entry = device(world, name);
  const conversationId = [entry.pubkey as string, person(world, other).pubkey].sort().join(':');
  await entry.backend.send({ recipients: [], conversationId, content: text });
});

Then('{string} has a ratchet chat with {string} ending in {string} as {string}', async (world: CoreWorld, name: string, other: string, text: string, status: string) => {
  const entry = device(world, name);
  const conversationId = [entry.pubkey as string, person(world, other).pubkey].sort().join(':');
  await vi.waitFor(async () => {
    const page = await entry.backend.messages({ conversationId });
    const last = page.messages.at(-1);
    expect([last?.content, last?.status]).toEqual([text, status]);
  }, WAIT);
});

Then('the watcher on {string} saw {string}', (world: CoreWorld, name: string, texts: string) => {
  expect(device(world, name).seen.map((message) => message.content)).toEqual(texts.split('|'));
});

Then('no event on the network carries {string} or {string} in the clear', (world: CoreWorld, first: string, second: string) => {
  const published = JSON.stringify(r(world).network.published);
  expect(r(world).network.published.length).toBeGreaterThan(0);
  expect(published).not.toContain(first);
  expect(published).not.toContain(second);
});

Then('{string} reports a ratchet status for {string}', (world: CoreWorld, name: string, who: string) => {
  expect(device(world, name).backend.status()).toEqual({
    available: true,
    ownerPubkey: person(world, who).pubkey,
    implementations: ['ndr'],
    capabilities: ['send', 'receive', 'subscribe', 'history', 'double-ratchet'],
  });
});

Then('the storage of {string} holds only ciphertext sealed to {string}', async (world: CoreWorld, name: string, who: string) => {
  const { storage } = device(world, name);
  const owner = person(world, who);
  const entries = [...Array(storage.length).keys()].map((index) => storage.key(index) as string);
  expect(entries.length).toBeGreaterThan(2);
  for (const key of entries) {
    expect(key).toMatch(new RegExp(`^kernl:ratchet:v1:${owner.pubkey}:(index|\\d+)$`));
    const parts = JSON.parse(storage.getItem(key) as string) as string[];
    for (const part of parts) expect(await owner.signer.nip44.decrypt(owner.pubkey, part)).not.toBe(part);
  }
  const raw = entries.map((key) => storage.getItem(key)).join('');
  for (const other of r(world).people.values()) expect(raw).not.toContain(other.pubkey);
  expect(raw).not.toContain('first');
});

When('{string} reloads', async (world: CoreWorld, name: string) => {
  const entry = device(world, name);
  entry.backend.close?.();
  entry.backend = backendOn(world, entry);
  await entry.backend.conversations();
});

Then('sending over ratchet on {string} to {string} fails with {string}', async (world: CoreWorld, name: string, to: string, reason: string) => {
  expect(await failure(() => device(world, name).backend.send({ recipients: pubkeysOf(world, to), content: 'x' }))).toBe(reason);
});

Then('sending over ratchet on {string} in the conversation of {string} fails with {string}', async (world: CoreWorld, name: string, names: string, reason: string) => {
  const conversationId = pubkeysOf(world, names).sort().join(':');
  expect(await failure(() => device(world, name).backend.send({ recipients: [], conversationId, content: 'x' }))).toBe(reason);
});

Then('the ratchet status on {string} is unavailable', (world: CoreWorld, name: string) => {
  expect(device(world, name).backend.status()).toMatchObject({ available: false, implementations: ['ndr'] });
});

Then('{string} lists {int} ratchet conversations', async (world: CoreWorld, name: string, count: number) => {
  expect((await device(world, name).backend.conversations()).conversations).toHaveLength(count);
});

When('{string} signs in read-only on {string}', (world: CoreWorld, who: string, name: string) => {
  const entry = device(world, name);
  const owner = person(world, who);
  entry.signer = messagingSigner(new ReadonlyAccount(owner.pubkey, { getPublicKey: async () => owner.pubkey } as never));
  entry.pubkey = owner.pubkey;
  entry.changes.next();
});

When('{string} signs in on {string}', async (world: CoreWorld, who: string, name: string) => {
  const entry = device(world, name);
  const owner = person(world, who);
  entry.signer = owner.signer;
  entry.pubkey = owner.pubkey;
  entry.changes.next();
  await entry.backend.conversations();
});

When('the ratchet backend on {string} is closed', (world: CoreWorld, name: string) => {
  const entry = device(world, name);
  entry.backend.close?.();
  entry.signer = undefined;
  entry.pubkey = undefined;
});

Given('the default messaging registry with a ratchet backend following {string}', (world: CoreWorld, name: string) => {
  const entry = addDevice(world, name);
  entry.registry = createDefaultMessaging({ storage: new MemoryStorage(), signer: () => entry.signer, backends: { ratchet: () => entry.backend } });
});

Then('provider {string} on {string} is unavailable because {string}', (world: CoreWorld, id: string, name: string, reason: string) => {
  expect(device(world, name).registry?.get(id)?.availability).toEqual({ available: false, reason });
});

Then('provider {string} on {string} is available', (world: CoreWorld, id: string, name: string) => {
  expect(device(world, name).registry?.get(id)?.availability).toEqual({ available: true });
});

function sealedFor(world: CoreWorld, who: string, storage: MemoryStorage): StorageAdapter {
  const owner = person(world, who);
  return createSealedRatchetStorage({ storage, signer: owner.signer, owner: owner.pubkey });
}

Given('sealed ratchet storage for {string}', (world: CoreWorld, who: string) => {
  const storage = new MemoryStorage();
  r(world).sealed = { storage, adapter: sealedFor(world, who, storage) };
});

When('the sealed storage puts a value of {int} characters at {string}', async (world: CoreWorld, size: number, key: string) => {
  await r(world).sealed?.adapter.put(key, 'é'.repeat(size));
});

When('the sealed storage puts {string} at {string} and {string} at {string}', async (world: CoreWorld, first: string, firstKey: string, second: string, secondKey: string) => {
  await r(world).sealed?.adapter.put(firstKey, first);
  await r(world).sealed?.adapter.put(secondKey, second);
  await r(world).sealed?.adapter.put(secondKey, second);
});

When('the sealed storage deletes {string} and {string}', async (world: CoreWorld, first: string, second: string) => {
  await r(world).sealed?.adapter.del(first);
  await r(world).sealed?.adapter.del(second);
});

Then('the sealed storage lists {string} under {string} and {int} keys in all', async (world: CoreWorld, key: string, prefix: string, count: number) => {
  const adapter = r(world).sealed?.adapter as StorageAdapter;
  expect(await adapter.list(prefix)).toEqual([key]);
  expect(await adapter.list()).toHaveLength(count);
});

Then('fresh sealed storage for {string} over the same place reads the {int} characters at {string} and nothing at {string}', async (world: CoreWorld, who: string, size: number, key: string, gone: string) => {
  const fresh = sealedFor(world, who, (r(world).sealed as { storage: MemoryStorage }).storage);
  expect(await fresh.get(key)).toBe('é'.repeat(size));
  expect(await fresh.get(key)).toBe('é'.repeat(size));
  expect(await fresh.get(gone)).toBeUndefined();
});

Then('fresh sealed storage for {string} returns the newer value when a put lands during a read', async (world: CoreWorld, who: string) => {
  const fresh = sealedFor(world, who, (r(world).sealed as { storage: MemoryStorage }).storage);
  const reading = fresh.get('v2/other');
  await fresh.put('v2/other', 'newer');
  expect(await reading).toBe('newer');
});
