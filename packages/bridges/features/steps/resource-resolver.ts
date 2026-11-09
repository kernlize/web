import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createBridgeResourceResolver, type BridgeRegistry, type ResourceResolveInit } from '@kernlize/bridges';
import { VALID_MAGNET, capture, expectReason, type BridgeWorld } from './world';

type WindowInit = ResourceResolveInit & { windowId?: string };

function registry(world: BridgeWorld): BridgeRegistry {
  if (!world.registry) throw new Error('no registry');
  return world.registry;
}

function resolve(world: BridgeWorld, url: string, init: WindowInit = {}): Promise<void> {
  const resolver = world.resolver;
  if (!resolver) throw new Error('no resolver');
  return capture(world, () => resolver(url, init));
}

Given('a resource resolver over the registry', (world: BridgeWorld) => {
  world.resolver = createBridgeResourceResolver(registry(world));
});

Given('a resource resolver over the registry deriving the requester from the init', (world: BridgeWorld) => {
  world.resolver = createBridgeResourceResolver(registry(world), {
    requesterFor: (init: WindowInit) => ({ dTag: `applet:${init.windowId ?? 'unknown'}`, hash: 'h' }),
  });
});

When('the resolver fetches {string}', (world: BridgeWorld, url: string) => resolve(world, url));

When('the resolver fetches a valid magnet link', (world: BridgeWorld) => resolve(world, VALID_MAGNET));

When('the resolver fetches a valid magnet link with window {string}', (world: BridgeWorld, windowId: string) =>
  resolve(world, VALID_MAGNET, { windowId }),
);

When('the resolver fetches a valid magnet link as applet {string}', (world: BridgeWorld, dTag: string) =>
  resolve(world, VALID_MAGNET, { windowId: 'ignored', requester: { dTag: `applet:${dTag}`, hash: 'h' } }),
);

When(
  'the resolver fetches a valid magnet link with a signal and header {string} set to {string}',
  (world: BridgeWorld, name: string, value: string) =>
    resolve(world, VALID_MAGNET, { signal: new AbortController().signal, headers: { [name]: value } }),
);

Then('the resolved response status is {int}', (world: BridgeWorld, status: number) => {
  expect(world.error).toBeUndefined();
  expect(world.response?.status).toBe(status);
});

Then('the resolved response body is {string}', async (world: BridgeWorld, body: string) => {
  expect(await world.response?.text()).toBe(body);
});

Then('the resolved response JSON has kind {string} and label {string}', async (world: BridgeWorld, kind: string, label: string) => {
  expect(await world.response?.json()).toMatchObject({ kind, label });
});

Then('the resolved response JSON has kind {string}', async (world: BridgeWorld, kind: string) => {
  expect(await world.response?.json()).toMatchObject({ kind });
});

Then('the bridge saw requester {string}', (world: BridgeWorld, requester: string) => {
  const seen = world.seenContext?.requester;
  expect(seen === 'shell' ? seen : seen?.dTag).toBe(requester);
});

Then('the bridge saw the signal and header {string} set to {string}', (world: BridgeWorld, name: string, value: string) => {
  expect(world.seenContext?.signal).toBeInstanceOf(AbortSignal);
  expect(world.seenContext?.headers).toEqual({ [name]: value });
});

Then('the resolver fails with {string}', (world: BridgeWorld, reason: string) => {
  expectReason(world.error, reason);
});
