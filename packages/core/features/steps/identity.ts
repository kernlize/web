import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { EMPTY, Observable, of } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { PrivateKeySigner } from 'applesauce-signers';
import type { AddressPointerLoader, LoadableAddressPointer } from 'applesauce-loaders/loaders';
import type { NostrEvent } from '@napplet/core';
import { createIdentityProviders, type IdentityProfile, type IdentityProviders, type RelayTiers } from '@kernl/core';
import { scratch, splitList, type CoreWorld } from './world.js';

const signers = new Map<string, PrivateKeySigner>();

function signerFor(name: string): PrivateKeySigner {
  const existing = signers.get(name);
  if (existing) return existing;
  const signer = new PrivateKeySigner();
  signers.set(name, signer);
  return signer;
}

async function pubkeyOf(name: string): Promise<string> {
  return signerFor(name).getPublicKey();
}

async function replaceable(name: string, kind: number, tags: string[][], content: string): Promise<NostrEvent> {
  return signerFor(name).signEvent({ kind, tags, content, created_at: 1_700_000_000 });
}

function store(world: CoreWorld): EventStore {
  return scratch(world).eventStore as EventStore;
}

const FULL_PROFILE = {
  name: 'alice',
  display_name: 'Alice',
  about: 'dev',
  picture: 'https://img.example/a.png',
  banner: 'https://img.example/b.png',
  nip05: 'alice@example.com',
  lud16: 'alice@pay.example',
  website: 'https://alice.example',
};

function providers(world: CoreWorld, loader?: AddressPointerLoader): IdentityProviders {
  const state = scratch(world);
  return createIdentityProviders(store(world), state.pool, state.tiers as RelayTiers, loader ? { loader } : {});
}

function makeLoader(world: CoreWorld, load: (pointer: LoadableAddressPointer) => Observable<NostrEvent>): AddressPointerLoader {
  const calls = (scratch(world).loaderCalls ??= []) as LoadableAddressPointer[];
  const loader = ((pointer: LoadableAddressPointer) => {
    calls.push(pointer);
    return load(pointer);
  }) as AddressPointerLoader;
  loader.stop = () => undefined;
  return loader;
}

Given('an event store', (world: CoreWorld) => {
  scratch(world).eventStore = new EventStore();
});

Given('the store holds a kind 0 profile for {string} with every field', async (world: CoreWorld, name: string) => {
  store(world).add(await replaceable(name, 0, [], JSON.stringify(FULL_PROFILE)));
});

Given('the store holds a kind 0 profile for {string} with only a name', async (world: CoreWorld, name: string) => {
  store(world).add(await replaceable(name, 0, [], JSON.stringify({ name, about: '' })));
});

Given('the store holds a kind 0 profile for {string} with only an about', async (world: CoreWorld, name: string) => {
  store(world).add(await replaceable(name, 0, [], JSON.stringify({ about: 'likes relays' })));
});

Then('the profile is exactly about {string}', (world: CoreWorld, about: string) => {
  expect(scratch(world).profile as IdentityProfile).toEqual({ about });
});

Given('the store holds a kind 0 profile for {string} with broken content', async (world: CoreWorld, name: string) => {
  store(world).add(await replaceable(name, 0, [], 'not json'));
});

Given('a loader that returns a kind 0 profile for {string} with only a name', async (world: CoreWorld, name: string) => {
  const event = await replaceable(name, 0, [], JSON.stringify({ name }));
  scratch(world).loader = makeLoader(world, () => of(event));
});

Given('a loader that stores a kind 0 profile for {string} with only a name and emits nothing', async (world: CoreWorld, name: string) => {
  const event = await replaceable(name, 0, [], JSON.stringify({ name }));
  scratch(world).loader = makeLoader(world, () => {
    store(world).add(event);
    return EMPTY;
  });
});

Given('a loader that returns nothing', (world: CoreWorld) => {
  scratch(world).loader = makeLoader(world, () => EMPTY);
});

Given('the store holds a kind 3 follow list for {string} following {string}', async (world: CoreWorld, name: string, pubkeys: string) => {
  store(world).add(await replaceable(name, 3, splitList(pubkeys).map((pubkey) => ['p', pubkey]), ''));
});

Given('the store holds a kind 10000 mute list for {string} muting {string}', async (world: CoreWorld, name: string, pubkeys: string) => {
  store(world).add(await replaceable(name, 10000, [...splitList(pubkeys).map((pubkey) => ['p', pubkey]), ['e', 'ignored']], ''));
});

Given('the store holds a kind 10002 relay list for {string} with {string}', async (world: CoreWorld, name: string, entries: string) => {
  const tags = splitList(entries).map((entry) => {
    const [url, marker] = entry.split('=') as [string, string];
    return marker ? ['r', url, marker] : ['r', url];
  });
  store(world).add(await replaceable(name, 10002, tags, ''));
});

When('the identity providers look up the profile of {string}', async (world: CoreWorld, name: string) => {
  const state = scratch(world);
  state.profile = await providers(world, state.loader as AddressPointerLoader | undefined).getProfile?.(await pubkeyOf(name), { type: 'identity.getProfile', id: 'q1' });
});

When('the identity providers without an injected loader look up the profile of {string}', async (world: CoreWorld, name: string) => {
  scratch(world).profile = await providers(world).getProfile?.(await pubkeyOf(name), { type: 'identity.getProfile', id: 'q1' });
});

When('the identity providers look up follows, mutes and relays of {string}', async (world: CoreWorld, name: string) => {
  const state = scratch(world);
  const identity = providers(world, state.loader as AddressPointerLoader | undefined);
  const pubkey = await pubkeyOf(name);
  state.identity = identity;
  state.follows = await identity.getFollows?.(pubkey, { type: 'identity.getFollows', id: 'q2' });
  state.mutes = await identity.getMutes?.(pubkey, { type: 'identity.getMutes', id: 'q3' });
  state.relays = await identity.getRelays(pubkey);
});

Then('the profile has name {string}, display name {string}, about {string}, picture {string}, banner {string}, address {string}, payment {string} and website {string}', (world: CoreWorld, ...values: string[]) => {
  const [name, displayName, about, picture, banner, nip05, lud16, website] = values;
  expect(scratch(world).profile).toEqual({ name, displayName, about, picture, banner, nip05, lud16, website });
});

Then('the profile is exactly name {string}', (world: CoreWorld, name: string) => {
  expect(scratch(world).profile as IdentityProfile).toEqual({ name });
});

Then('the profile is null', (world: CoreWorld) => {
  expect(scratch(world).profile).toBeNull();
});

Then('the loader was asked for kind {int} from the discovery tier', (world: CoreWorld, kind: number) => {
  const calls = scratch(world).loaderCalls as LoadableAddressPointer[];
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ kind, relays: (scratch(world).tiers as RelayTiers).get().discovery });
});

Then('the default loader asked every discovery relay', (world: CoreWorld) => {
  const asked = new Set(scratch(world).pool.calls.filter((call) => call.method === 'request').flatMap((call) => call.relays.map((url) => url.replace(/\/$/, ''))));
  expect([...asked].sort()).toEqual([...(scratch(world).tiers as RelayTiers).get().discovery].sort());
});

Then('the follows are {string}', (world: CoreWorld, pubkeys: string) => {
  expect(scratch(world).follows).toEqual(splitList(pubkeys));
});

Then('the mutes are {string}', (world: CoreWorld, pubkeys: string) => {
  expect(scratch(world).mutes).toEqual(splitList(pubkeys));
});

Then('the relays are {string}', (world: CoreWorld, entries: string) => {
  const expected = Object.fromEntries(splitList(entries).map((entry) => {
    const [url, marker] = entry.split('=') as [string, string];
    return [url, { read: marker.includes('read'), write: marker.includes('write') }];
  }));
  expect(scratch(world).relays).toEqual(expected);
});

Then('the list, zap, blocked and badge lookups return empty', async (world: CoreWorld) => {
  const identity = scratch(world).identity as IdentityProviders;
  expect(await identity.getList?.('bookmarks', 'x', { type: 'identity.getList', id: 'q', listType: 'bookmarks' })).toEqual([]);
  expect(await identity.getZaps?.('x', { type: 'identity.getZaps', id: 'q' })).toEqual([]);
  expect(await identity.getBlocked?.('x', { type: 'identity.getBlocked', id: 'q' })).toEqual([]);
  expect(await identity.getBadges?.('x', { type: 'identity.getBadges', id: 'q' })).toEqual([]);
});
