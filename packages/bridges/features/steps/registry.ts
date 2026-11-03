import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createBridgeRegistry, type BridgeRegistryOptions } from '@kernl/bridges';
import { VALID_MAGNET, capture, expectReason, splitList, type BridgeWorld, type FakeBridge } from './world';

function fakeBridge(world: BridgeWorld, id: string, scheme: string): FakeBridge {
  const fake: FakeBridge = {
    id,
    label: 'test',
    schemes: [scheme],
    exposure: { revealsAddress: false, encryptedInTransit: true, publicActivity: false },
    result: { kind: 'job', id: `${id}-job`, label: id },
    availability: () => (fake.unavailable ? { available: false, reason: fake.unavailable } : { available: true }),
    async resolve(_locator, context) {
      world.seenContext = context;
      if (fake.failure !== undefined) throw fake.failure;
      return fake.result;
    },
  };
  return fake;
}

function startRegistry(world: BridgeWorld, authorize?: BridgeRegistryOptions['authorize']): void {
  world.events = [];
  world.fakes = new Map();
  const events = world.events;
  world.registry = createBridgeRegistry({
    ...(authorize ? { authorize } : {}),
    onResolve: (event) => events.push(event),
  });
}

function fake(world: BridgeWorld, id: string): FakeBridge {
  const found = world.fakes?.get(id);
  if (!found) throw new Error(`no fake bridge ${id}`);
  return found;
}

Given('a bridge registry', (world: BridgeWorld) => {
  startRegistry(world);
});

Given('a bridge registry whose consent hook denies', (world: BridgeWorld) => {
  startRegistry(world, () => false);
});

Given('a bridge registry whose consent hook allows after a tick', (world: BridgeWorld) => {
  startRegistry(world, async (locator, bridge) => {
    world.consentSeen = { bridge: bridge.id, scheme: locator.scheme };
    await Promise.resolve();
    return true;
  });
});

Given('the fake bridge {string} serving {string} is registered', (world: BridgeWorld, id: string, scheme: string) => {
  const bridge = fakeBridge(world, id, scheme);
  world.fakes?.set(id, bridge);
  world.error = undefined;
  try {
    world.registry?.register(bridge);
  } catch (error) {
    world.error = error;
  }
});

Given('the fake bridge {string} is unavailable because {string}', (world: BridgeWorld, id: string, reason: string) => {
  fake(world, id).unavailable = reason;
});

Given('the fake bridge {string} fails with {string}', (world: BridgeWorld, id: string, reason: string) => {
  fake(world, id).failure = new Error(reason);
});

Given('the fake bridge {string} fails with a bare string', (world: BridgeWorld, id: string) => {
  fake(world, id).failure = 'boom';
});

Given('the fake bridge {string} answers with bytes {string}', (world: BridgeWorld, id: string, body: string) => {
  fake(world, id).result = { kind: 'bytes', response: new Response(body) };
});

Given('the fake bridge {string} answers with a conversation', (world: BridgeWorld, id: string) => {
  fake(world, id).result = { kind: 'conversation', id: 'conv', participants: ['ada@example.com'] };
});

Then('registration fails with {string}', (world: BridgeWorld, reason: string) => {
  expectReason(world.error, reason);
});

Then('the registry lists {string}', (world: BridgeWorld, ids: string) => {
  expect(world.registry?.list().map((bridge) => bridge.id)).toEqual(splitList(ids));
});

Then('the bridge for scheme {string} is {string}', (world: BridgeWorld, scheme: string, id: string) => {
  expect(world.registry?.forScheme(scheme)?.id).toBe(id);
});

Then('there is no bridge for scheme {string}', (world: BridgeWorld, scheme: string) => {
  expect(world.registry?.forScheme(scheme)).toBeUndefined();
});

When('the registry resolves {string}', async (world: BridgeWorld, uri: string) => {
  const registry = world.registry;
  if (!registry) throw new Error('no registry');
  await capture(world, () => registry.resolve(uri, { requester: 'shell' }));
});

When('the registry resolves a valid magnet link', async (world: BridgeWorld) => {
  const registry = world.registry;
  if (!registry) throw new Error('no registry');
  await capture(world, () => registry.resolve(VALID_MAGNET, { requester: 'shell' }));
});

Then('resolution fails with {string}', (world: BridgeWorld, reason: string) => {
  expectReason(world.error, reason);
});

Then('resolution yields a job labelled {string}', (world: BridgeWorld, label: string) => {
  expect(world.result).toMatchObject({ kind: 'job', label });
});

Then(
  'the registry reported bridge {string} scheme {string} with {string}',
  (world: BridgeWorld, bridge: string, scheme: string, reason: string) => {
    expect(world.events?.at(-1)).toEqual({ bridge, scheme, ok: false, reason });
  },
);

Then('the registry reported bridge {string} scheme {string} as ok', (world: BridgeWorld, bridge: string, scheme: string) => {
  expect(world.events?.at(-1)).toEqual({ bridge, scheme, ok: true });
});

Then('the consent hook saw bridge {string} and scheme {string}', (world: BridgeWorld, bridge: string, scheme: string) => {
  expect(world.consentSeen).toEqual({ bridge, scheme });
});
