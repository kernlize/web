import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import {
  createGroupMessagesProvider,
  createLegacyMessagesProvider,
  createMemoryBackend,
  createPrivateMessagesProvider,
  createRatchetMessagesProvider,
  describeProvider,
  type MessagingProvider,
  type ProviderDeps,
} from '@kernl/messaging';
import { state, type MessagingWorld } from './world.js';

const BUILT_IN: Record<string, (deps: ProviderDeps) => MessagingProvider> = {
  private: createPrivateMessagesProvider,
  legacy: createLegacyMessagesProvider,
  ratchet: createRatchetMessagesProvider,
  group: createGroupMessagesProvider,
};

function build(world: MessagingWorld, id: string): void {
  const s = state(world);
  const factory = BUILT_IN[id];
  if (!factory) throw new Error(`no built-in provider ${id}`);
  s.injected = createMemoryBackend();
  s.provider = factory({ available: () => s.available, createBackend: () => s.injected ?? createMemoryBackend() });
}

function provider(world: MessagingWorld): MessagingProvider {
  const current = state(world).provider;
  if (!current) throw new Error('no provider');
  return current;
}

Given('the built-in messaging provider {string}', (world: MessagingWorld, id: string) => {
  build(world, id);
});

Given(
  'the built-in messaging provider {string} that is unavailable because {string}',
  (world: MessagingWorld, id: string, reason: string) => {
    state(world).available = { available: false, reason };
    build(world, id);
  },
);

Then('the messaging provider name is {string}', (world: MessagingWorld, name: string) => {
  expect(provider(world).name).toBe(name);
});

Then('the messaging provider description is {string}', (world: MessagingWorld, description: string) => {
  expect(provider(world).description).toBe(description);
});

Then(
  'the messaging provider security properties are {word}, {word}, {string}, {word}, {word}, {word}',
  (world: MessagingWorld, fs: string, pcs: string, metadata: string, same: string, groups: string, experimental: string) => {
    expect(provider(world).properties).toMatchObject({
      forwardSecrecy: fs === 'true',
      postCompromiseSecurity: pcs === 'true',
      metadataProtection: metadata,
      requiresSameClient: same === 'true',
      groups: groups === 'true',
      experimental: experimental === 'true',
    });
  },
);

Then('the messaging provider specification is {string}', (world: MessagingWorld, specification: string) => {
  expect(provider(world).properties.specification).toBe(specification);
});

Then('the messaging provider description rows are:', (world: MessagingWorld, table: DataTable) => {
  const expected = table.raw().map(([label, value]) => ({ label, value }));
  expect(describeProvider(provider(world))).toEqual(expected);
});

Then('no messaging description row mentions {string} or {string}', (world: MessagingWorld, first: string, second: string) => {
  for (const row of describeProvider(provider(world))) {
    const text = `${row.label} ${row.value}`.toLowerCase();
    expect(text).not.toContain(first.toLowerCase());
    expect(text).not.toContain(second.toLowerCase());
  }
});

Then('the messaging provider availability is unavailable because {string}', (world: MessagingWorld, reason: string) => {
  expect(provider(world).availability()).toEqual({ available: false, reason });
});

When('the messaging provider becomes available', (world: MessagingWorld) => {
  state(world).available = { available: true };
});

Then('the messaging provider availability is available', (world: MessagingWorld) => {
  expect(provider(world).availability()).toEqual({ available: true });
});

Then('the messaging provider builds the injected backend', (world: MessagingWorld) => {
  expect(provider(world).createBackend()).toBe(state(world).injected);
});
