import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { REMEMBER_GRANTS_KEY, type StorageLike } from '../../src/shell/contract.ts';
import { PREVIEW_STORAGE_PREFIX, scopedStorage } from '../../src/shell/host.ts';
import { readRemember, writeRemember } from '../../src/shell/remember-grants.ts';

interface RememberWorld {
  rememberStorage?: StorageLike;
  rememberItems?: Map<string, string>;
}

function storage(world: RememberWorld): StorageLike {
  if (!world.rememberStorage) throw new Error('start with an empty shell storage');
  return world.rememberStorage;
}

Given('an empty shell storage for the remember choice', (world: RememberWorld) => {
  const items = new Map<string, string>();
  world.rememberItems = items;
  world.rememberStorage = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
});

When('the person stops remembering grants', (world: RememberWorld) => writeRemember(storage(world), false));

When('the person remembers grants again', (world: RememberWorld) => writeRemember(storage(world), true));

When('the person stops remembering grants in the live shell', (world: RememberWorld) => writeRemember(storage(world), false));

Then('the shell remembers grants', (world: RememberWorld) => {
  expect(readRemember(storage(world))).toBe(true);
});

Then('the shell does not remember grants', (world: RememberWorld) => {
  expect(readRemember(storage(world))).toBe(false);
});

Then('a shell opened over the same storage does not remember grants', (world: RememberWorld) => {
  expect(readRemember({ ...storage(world) })).toBe(false);
});

Then('a shell opened over the same storage remembers grants', (world: RememberWorld) => {
  expect(readRemember({ ...storage(world) })).toBe(true);
});

Then('the shell storage holds nothing under the remember key', (world: RememberWorld) => {
  expect(world.rememberItems?.has(REMEMBER_GRANTS_KEY)).toBe(false);
});

Then("the preview's view of the storage remembers grants", (world: RememberWorld) => {
  expect(readRemember(scopedStorage(storage(world), PREVIEW_STORAGE_PREFIX))).toBe(true);
});
