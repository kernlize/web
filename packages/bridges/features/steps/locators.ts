import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import { formatLocator, isNzbUrl, parseLocator } from '@kernl/bridges';
import { expectReason, splitList, type BridgeWorld } from './world';

When('the locator {string} is parsed', (world: BridgeWorld, uri: string) => {
  world.error = undefined;
  try {
    world.locator = parseLocator(uri);
  } catch (error) {
    world.error = error;
  }
});

Then('the locator scheme is {string}', (world: BridgeWorld, scheme: string) => {
  expect(world.locator?.scheme).toBe(scheme);
});

Then('the locator field {string} is {string}', (world: BridgeWorld, key: string, value: string) => {
  expect(world.locator?.fields[key]).toBe(value);
});

Then('the locator list {string} is {string}', (world: BridgeWorld, key: string, list: string) => {
  expect(world.locator?.fields[key]).toEqual(splitList(list));
});

Then('the locator has no field {string}', (world: BridgeWorld, key: string) => {
  expect(world.locator?.fields).not.toHaveProperty(key);
});

Then('the locator has no fields', (world: BridgeWorld) => {
  expect(world.locator?.fields).toEqual({});
});

Then('the locator label is {string}', (world: BridgeWorld, label: string) => {
  expect(world.locator).toBeDefined();
  if (world.locator) expect(formatLocator(world.locator)).toBe(label);
});

Then('parsing fails with {string}', (world: BridgeWorld, reason: string) => {
  expectReason(world.error, reason);
});

Then('the URL {string} is recognised as an NZB document', (_world: BridgeWorld, url: string) => {
  expect(isNzbUrl(url)).toBe(true);
});

Then('the URL {string} is not recognised as an NZB document', (_world: BridgeWorld, url: string) => {
  expect(isNzbUrl(url)).toBe(false);
});
