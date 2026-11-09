import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createRelayTiers, type RelayTier, type RelayTiers } from '@kernlize/core';
import { attempt, scratch, splitList, type CoreWorld } from './world.js';

function tiers(world: CoreWorld): RelayTiers {
  const value = scratch(world).tiers as RelayTiers | undefined;
  if (!value) throw new Error('create relay tiers first');
  return value;
}

function create(world: CoreWorld, defaults: Partial<Record<RelayTier, readonly string[]>> = {}): void {
  const state = scratch(world);
  const created = createRelayTiers(state.storage, defaults);
  state.tiers = created;
  state.tierSnapshots = [];
  created.changes$.subscribe((config) => (state.tierSnapshots as unknown[]).push(config));
}

Given('kernl relay tiers over empty storage', (world: CoreWorld) => {
  create(world);
});

Given('kernl relay tiers over that storage', (world: CoreWorld) => {
  create(world);
});

Given('kernl relay tiers over empty storage with {string} defaulting to {string}', (world: CoreWorld, tier: RelayTier, urls: string) => {
  create(world, { [tier]: splitList(urls) });
});

Given('kernl relay tiers over that storage with {string} defaulting to {string}', (world: CoreWorld, tier: RelayTier, urls: string) => {
  create(world, { [tier]: splitList(urls) });
});

Given('storage key {string} holding {string}', (world: CoreWorld, key: string, raw: string) => {
  scratch(world).storage.setItem(key, raw);
});

When('the shell adds {string} to the {string} tier', async (world: CoreWorld, url: string, tier: RelayTier) => {
  await attempt(world, () => tiers(world).add(tier, url));
});

When('the shell sets the {string} tier to {string}', async (world: CoreWorld, tier: RelayTier, urls: string) => {
  await attempt(world, () => tiers(world).set(tier, splitList(urls)));
});

When('the shell removes {string} from the {string} tier', (world: CoreWorld, url: string, tier: RelayTier) => {
  tiers(world).remove(tier, url);
});

Then('the {string} tier is {string}', (world: CoreWorld, tier: RelayTier, urls: string) => {
  expect(tiers(world).get()[tier]).toEqual(splitList(urls));
});

Then('the tier configuration was observed {int} times', (world: CoreWorld, count: number) => {
  expect(scratch(world).tierSnapshots).toHaveLength(count);
});

Then('storage key {string} holds the current tiers', (world: CoreWorld, key: string) => {
  expect(JSON.parse(scratch(world).storage.getItem(key) ?? 'null')).toEqual(tiers(world).get());
});
