import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import {
  createLegacyMessagesProvider,
  createMessagingRegistry,
  createMemoryBackend,
  createPrivateMessagesProvider,
  createRatchetMessagesProvider,
  type MessagingBackend,
  type MessagingProvider,
  type ProviderDeps,
} from '@kernlize/messaging';
import { attempt, list, state, type FakeProvider, type MessagingWorld } from './world.js';

const FACTORIES: Record<string, (deps: ProviderDeps) => MessagingProvider> = {
  private: createPrivateMessagesProvider,
  legacy: createLegacyMessagesProvider,
  ratchet: createRatchetMessagesProvider,
};

function fake(world: MessagingWorld, id: string): FakeProvider {
  const s = state(world);
  let entry = s.fakes.get(id);
  if (!entry) {
    entry = { availability: { available: true }, created: 0, closed: false, closable: true };
    s.fakes.set(id, entry);
  }
  return entry;
}

function buildProvider(world: MessagingWorld, id: string): MessagingProvider {
  const entry = fake(world, id);
  const factory = FACTORIES[id];
  if (!factory) throw new Error(`no built-in provider ${id}`);
  return factory({
    available: () => entry.availability,
    createBackend: (): MessagingBackend => {
      entry.created += 1;
      entry.backend = createMemoryBackend();
      const { close, ...rest } = entry.backend;
      return entry.closable
        ? {
            ...rest,
            close: () => {
              entry.closed = true;
              close();
            },
          }
        : rest;
    },
  });
}

Given('a messaging registry', (world: MessagingWorld) => {
  const s = state(world);
  s.registry = createMessagingRegistry({ onChange: (prefs) => s.notifications.push(prefs) });
});

Given('a bare messaging registry', (world: MessagingWorld) => {
  state(world).registry = createMessagingRegistry();
});

Given(
  'a messaging registry restoring enabled {string} with default {string}',
  (world: MessagingWorld, enabled: string, defaultProvider: string) => {
    const s = state(world);
    s.registry = createMessagingRegistry({
      preferences: { enabled: list(enabled), defaultProvider },
      onChange: (prefs) => s.notifications.push(prefs),
    });
  },
);

Given('a messaging registry restoring enabled {string} with no default', (world: MessagingWorld, enabled: string) => {
  const s = state(world);
  s.registry = createMessagingRegistry({
    preferences: { enabled: list(enabled) },
    onChange: (prefs) => s.notifications.push(prefs),
  });
});

Given('a messaging registry restoring the order {string}', (world: MessagingWorld, order: string) => {
  const s = state(world);
  s.registry = createMessagingRegistry({ preferences: { enabled: [], order: list(order) }, onChange: (prefs) => s.notifications.push(prefs) });
});

When('I order the messaging providers {string}', (world: MessagingWorld, ids: string) =>
  attempt(world, () => state(world).registry?.setOrder(list(ids))),
);

Then('the messaging provider order is {string}', (world: MessagingWorld, ids: string) => {
  expect(state(world).registry?.preferences().order).toEqual(list(ids));
});

Given('messaging provider {string} is unavailable because {string}', (world: MessagingWorld, id: string, reason: string) => {
  fake(world, id).availability = { available: false, reason };
});

Given('messaging provider {string} has a backend that cannot be closed', (world: MessagingWorld, id: string) => {
  fake(world, id).closable = false;
});

When('I register the messaging provider {string}', (world: MessagingWorld, id: string) =>
  attempt(world, () => state(world).registry?.register(buildProvider(world, id))),
);

When('I enable messaging provider {string}', (world: MessagingWorld, id: string) =>
  attempt(world, () => state(world).registry?.enable(id)),
);

When('I disable messaging provider {string}', (world: MessagingWorld, id: string) =>
  attempt(world, () => state(world).registry?.disable(id)),
);

When('I set the default messaging provider to {string}', (world: MessagingWorld, id: string) =>
  attempt(world, () => state(world).registry?.setDefault(id)),
);

When('I send {string} to {string} with the registry composite', (world: MessagingWorld, content: string, recipient: string) =>
  attempt(world, async () => {
    state(world).sendResult = await state(world).registry?.composite().send({ recipients: [recipient], content });
  }),
);

When('I close the messaging registry', (world: MessagingWorld) => {
  state(world).registry?.close();
});

Then('the messaging error is {string}', (world: MessagingWorld, message: string) => {
  expect(state(world).error?.message).toBe(message);
});

Then('the messaging provider list is {string}', (world: MessagingWorld, ids: string) => {
  expect(state(world).registry?.list().map((entry) => entry.provider.id)).toEqual(list(ids));
});

Then('messaging provider {string} is listed as enabled', (world: MessagingWorld, id: string) => {
  expect(state(world).registry?.get(id)?.enabled).toBe(true);
});

Then('messaging provider {string} is listed as disabled', (world: MessagingWorld, id: string) => {
  expect(state(world).registry?.get(id)?.enabled).toBe(false);
});

Then('messaging provider {string} is listed as available', (world: MessagingWorld, id: string) => {
  expect(state(world).registry?.get(id)?.availability).toEqual({ available: true });
});

Then(
  'messaging provider {string} is listed as unavailable because {string}',
  (world: MessagingWorld, id: string, reason: string) => {
    expect(state(world).registry?.get(id)?.availability).toEqual({ available: false, reason });
  },
);

Then('the backend for messaging provider {string} was created {int} time(s)', (world: MessagingWorld, id: string, count: number) => {
  expect(fake(world, id).created).toBe(count);
});

Then('the backend for messaging provider {string} is closed', (world: MessagingWorld, id: string) => {
  expect(fake(world, id).closed).toBe(true);
});

Then('the messaging preferences are enabled {string} with no default', (world: MessagingWorld, enabled: string) => {
  const preferences = state(world).registry?.preferences();
  expect(preferences?.enabled).toEqual(list(enabled));
  expect(preferences && 'defaultProvider' in preferences).toBe(false);
});

Then(
  'the messaging preferences are enabled {string} with default {string}',
  (world: MessagingWorld, enabled: string, defaultProvider: string) => {
    const preferences = state(world).registry?.preferences();
    expect(preferences?.enabled).toEqual(list(enabled));
    expect(preferences?.defaultProvider).toBe(defaultProvider);
  },
);

Then('the messaging preferences snapshot is frozen', (world: MessagingWorld) => {
  const prefs = state(world).registry?.preferences();
  expect(Object.isFrozen(prefs)).toBe(true);
  expect(Object.isFrozen(prefs?.enabled)).toBe(true);
  expect(Object.isFrozen(prefs?.order)).toBe(true);
  expect(Object.isFrozen(prefs?.replyChoices)).toBe(true);
});

Then('the messaging change listener fired {int} time(s)', (world: MessagingWorld, count: number) => {
  expect(state(world).notifications).toHaveLength(count);
});

Then('messaging registry lookup of {string} returns the provider', (world: MessagingWorld, id: string) => {
  expect(state(world).registry?.get(id)?.provider.id).toBe(id);
});

Then('messaging registry lookup of {string} returns nothing', (world: MessagingWorld, id: string) => {
  expect(state(world).registry?.get(id)).toBeUndefined();
});

Then('the messaging registry composite is the same instance on every call', (world: MessagingWorld) => {
  const registry = state(world).registry;
  expect(registry?.composite()).toBe(registry?.composite());
});
