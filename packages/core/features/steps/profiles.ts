import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { Observable, Subject, type Subscription } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import { PrivateKeySigner } from 'applesauce-signers';
import { createProfiles, type ProfileCard, type ProfilePointer, type Profiles } from '@kernlize/core';
import type { NostrEvent } from '@napplet/core';
import { scratch, splitList, type CoreWorld } from './world.js';

const LOOKUP = ['wss://lookup-relay.com/'];
const KEEP_ALIVE_MS = 5;

interface ProfilesScratch {
  profiles: Profiles;
  asked: ProfilePointer[];
  feeds: Map<number, Subject<NostrEvent>>;
  closed: number;
  watched: Map<string, ProfileCard>;
  subscriptions: Subscription[];
}

const signers = new Map<string, PrivateKeySigner>();

function signerFor(name: string): PrivateKeySigner {
  let signer = signers.get(name);
  if (!signer) {
    signer = new PrivateKeySigner();
    signers.set(name, signer);
  }
  return signer;
}

const keyOf = (name: string): Promise<string> => signerFor(name).getPublicKey();

function p(world: CoreWorld): ProfilesScratch {
  const value = scratch(world).profiles as ProfilesScratch | undefined;
  if (!value) throw new Error('create a profile service first');
  return value;
}

function store(world: CoreWorld): EventStore {
  return scratch(world).eventStore as EventStore;
}

function build(world: CoreWorld, fail: boolean): void {
  const state: ProfilesScratch = { profiles: undefined as unknown as Profiles, asked: [], feeds: new Map(), closed: 0, watched: new Map(), subscriptions: [] };
  const load = (pointer: ProfilePointer): Observable<NostrEvent> => {
    state.asked.push(pointer);
    if (fail) return new Observable<NostrEvent>((observer) => observer.error(new Error('relay down')));
    const feed = state.feeds.get(pointer.kind) ?? new Subject<NostrEvent>();
    state.feeds.set(pointer.kind, feed);
    return new Observable<NostrEvent>((observer) => {
      const subscription = feed.subscribe((event) => {
        store(world).add(event);
        observer.next(event);
      });
      return () => {
        state.closed += 1;
        subscription.unsubscribe();
      };
    });
  };
  state.profiles = createProfiles({ store: store(world), load, lookupRelays: () => LOOKUP, keepAliveMs: KEEP_ALIVE_MS });
  scratch(world).profiles = state;
}

async function profileEvent(name: string, content: string): Promise<NostrEvent> {
  return signerFor(name).signEvent({ kind: 0, tags: [], content, created_at: 1_700_000_000 + signers.size });
}

async function watch(world: CoreWorld, name: string): Promise<void> {
  const pubkey = await keyOf(name);
  const state = p(world);
  state.subscriptions.push(state.profiles.card$(pubkey).subscribe((card) => state.watched.set(name, card)));
}

Given('a profile service over a recording loader', (world: CoreWorld) => build(world, false));
Given('a profile service over a failing loader', (world: CoreWorld) => build(world, true));

Given(
  'the store holds a profile for {string} with display name {string}, name {string}, picture {string}, address {string} and about {string}',
  async (world: CoreWorld, who: string, display: string, name: string, picture: string, nip05: string, about: string) => {
    store(world).add(await profileEvent(who, JSON.stringify({ display_name: display, name, picture, nip05, about })));
  },
);

Given('the store holds a broken profile for {string}', async (world: CoreWorld, who: string) => {
  store(world).add(await profileEvent(who, 'not json'));
});

Then('the card for {string} is named with the short key and not found', async (world: CoreWorld, who: string) => {
  const pubkey = await keyOf(who);
  expect(p(world).profiles.card(pubkey)).toEqual({ pubkey, name: `${pubkey.slice(0, 8)}…`, found: false });
});

Then('the card for {string} is named with the short key and found', async (world: CoreWorld, who: string) => {
  const pubkey = await keyOf(who);
  expect(p(world).profiles.card(pubkey)).toMatchObject({ name: `${pubkey.slice(0, 8)}…`, found: true });
});

Then('the card for {string} is named {string} with picture {string}', async (world: CoreWorld, who: string, name: string, picture: string) => {
  expect(p(world).profiles.card(await keyOf(who))).toMatchObject({ name, picture, found: true });
});

Then('the card for {string} carries address {string} and about {string}', async (world: CoreWorld, who: string, nip05: string, about: string) => {
  expect(p(world).profiles.card(await keyOf(who))).toMatchObject({ nip05, about });
});

Then('the card for {string} has no picture', async (world: CoreWorld, who: string) => {
  expect(p(world).profiles.card(await keyOf(who)).picture).toBeUndefined();
});

When('the shell watches the card for {string}', async (world: CoreWorld, who: string) => watch(world, who));

When('the shell watches the card for {string} twice', async (world: CoreWorld, who: string) => {
  await watch(world, who);
  await watch(world, who);
});

When('the shell watches the card for key {string}', (world: CoreWorld, key: string) => {
  p(world).subscriptions.push(p(world).profiles.card$(key).subscribe());
});

When('the shell watches the card for {string} and stops', async (world: CoreWorld, who: string) => {
  await watch(world, who);
  for (const subscription of p(world).subscriptions) subscription.unsubscribe();
});

Then('the watched card for {string} is named with the short key', async (world: CoreWorld, who: string) => {
  const pubkey = await keyOf(who);
  expect(p(world).watched.get(who)?.name).toBe(`${pubkey.slice(0, 8)}…`);
});

Then('the watched card for {string} is named {string}', (world: CoreWorld, who: string, name: string) => {
  expect(p(world).watched.get(who)?.name).toBe(name);
});

When('the loader delivers a profile for {string} named {string}', async (world: CoreWorld, who: string, name: string) => {
  p(world).feeds.get(0)?.next(await profileEvent(who, JSON.stringify({ name })));
});

When('the loader delivers a relay list for {string} writing to {string}', async (world: CoreWorld, who: string, relays: string) => {
  const tags = splitList(relays).map((url) => ['r', url, 'write']);
  p(world).feeds.get(10002)?.next(await signerFor(who).signEvent({ kind: 10002, tags, content: '', created_at: 1_700_000_000 }));
});

Then('the loader was asked for kinds {string} of {string} on the lookup relays', async (world: CoreWorld, kinds: string, who: string) => {
  const pubkey = await keyOf(who);
  expect(p(world).asked).toEqual(splitList(kinds).map((kind) => ({ kind: Number(kind), pubkey, relays: LOOKUP })));
});

Then('the loader was asked for kind 0 of {string} on {string}', async (world: CoreWorld, who: string, relays: string) => {
  expect(p(world).asked.at(-1)).toEqual({ kind: 0, pubkey: await keyOf(who), relays: splitList(relays) });
});

Then('the loader was asked {int} times', (world: CoreWorld, count: number) => {
  expect(p(world).asked).toHaveLength(count);
});

Then('watching {string} gives the same card', async (world: CoreWorld, who: string) => {
  const pubkey = await keyOf(who.toLowerCase());
  expect(p(world).profiles.card$(pubkey.toUpperCase())).toBe(p(world).profiles.card$(pubkey));
});

Then('the card lookups for {string} were closed after the keep-alive', async (world: CoreWorld) => {
  expect(p(world).closed).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, KEEP_ALIVE_MS * 4));
  expect(p(world).closed).toBe(2);
});
