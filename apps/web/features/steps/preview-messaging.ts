import { expect, vi } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import type { MessagingBackend, MessagingRegistry, WithProvider } from '@kernlize/messaging';

type DmMessage = Awaited<ReturnType<MessagingBackend['messages']>>['messages'][number];
import { MemoryStorage } from '../../../../packages/core/features/steps/world.ts';
import { PREVIEW_CORRESPONDENT, createPreviewMessaging } from '../../src/shell/preview-messaging.ts';

const PREFERENCES_KEY = 'kernl:preview:messaging:v1';
const OWNER = 'e8f1a4b7c9d2e5f8a1b4c7d0e3f6a9b2c5d8e1f4a7b0c3d6e9f2a5b8c1d4e7f0';
const OTHER = 'a'.repeat(64);

interface MessagingScratch {
  readonly storage: MemoryStorage;
  registry?: MessagingRegistry;
  conversationId?: string;
}

interface MessagingWorld {
  previewMessaging?: MessagingScratch;
}

function scratchOf(world: MessagingWorld): MessagingScratch {
  world.previewMessaging ??= { storage: new MemoryStorage() };
  return world.previewMessaging;
}

function registryOf(world: MessagingWorld): MessagingRegistry {
  const registry = scratchOf(world).registry;
  if (!registry) throw new Error('open the preview messaging first');
  return registry;
}

async function thread(world: MessagingWorld, conversationId: string): Promise<DmMessage[]> {
  const page = await registryOf(world).composite().messages({ conversationId });
  return page.messages;
}

After(async (world: MessagingWorld) => {
  if (!world.previewMessaging) return;
  world.previewMessaging.registry?.close();
  vi.useRealTimers();
});

Given('the preview messaging preferences are stored as {string}', (world: MessagingWorld, raw: string) => {
  scratchOf(world).storage.setItem(PREFERENCES_KEY, raw);
});

When('the preview messaging opens', (world: MessagingWorld) => {
  const scratch = scratchOf(world);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  scratch.registry = createPreviewMessaging(scratch.storage, OWNER);
});

Then('the preview messaging offers {string}', (world: MessagingWorld, ids: string) => {
  expect(registryOf(world).list().map((entry) => entry.provider.id)).toEqual(ids.split(','));
});

Then('the preview messaging has {string} enabled with {string} as the default', (world: MessagingWorld, ids: string, provider: string) => {
  const registry = registryOf(world);
  expect(registry.list().filter((entry) => entry.enabled).map((entry) => entry.provider.id)).toEqual(ids.split(','));
  expect(registry.preferences().defaultProvider).toBe(provider);
});

Then('the preview messaging reports {string} unavailable because {string}', (world: MessagingWorld, id: string, reason: string) => {
  expect(registryOf(world).get(id)?.availability).toEqual({ available: false, reason });
  expect(() => registryOf(world).enable(id)).toThrow();
});

Then('a {string} backend built anyway reports itself offline', async (world: MessagingWorld, id: string) => {
  const provider = registryOf(world).get(id)?.provider;
  if (!provider) throw new Error(`no provider ${id}`);
  const status = await provider.createBackend().status();
  expect(status).toMatchObject({ available: false });
});

When('the preview messaging enables {string}', (world: MessagingWorld, id: string) => {
  registryOf(world).enable(id);
});

Then('the preview messaging stored {string} as enabled', (world: MessagingWorld, ids: string) => {
  const stored = JSON.parse(scratchOf(world).storage.getItem(PREFERENCES_KEY) ?? 'null') as { enabled: string[] };
  expect(stored.enabled).toEqual(ids.split(','));
});

Then('the preview messaging has {int} conversation(s)', async (world: MessagingWorld, count: number) => {
  const page = await registryOf(world).composite().conversations();
  expect(page.conversations).toHaveLength(count);
});

Then('the preview correspondent has opened with {int} messages', async (world: MessagingWorld, count: number) => {
  const page = await registryOf(world).composite().conversations();
  const conversationId = page.conversations[0]?.id ?? '';
  const messages = await thread(world, conversationId);
  expect(messages).toHaveLength(count);
  for (const message of messages) expect(message.senderPubkey).toBe(PREVIEW_CORRESPONDENT);
});

When('the preview messaging sends {string} to {string} through {string}', async (world: MessagingWorld, content: string, to: string, provider: string) => {
  const recipients = { correspondent: [PREVIEW_CORRESPONDENT], 'another account': [OTHER] }[to];
  if (!recipients) throw new Error(`unknown recipient ${to}`);
  const request: WithProvider<Parameters<MessagingBackend['send']>[0]> = { provider, recipients, content };
  const result = await registryOf(world).composite().send(request);
  scratchOf(world).conversationId = result.message.conversationId;
});

When('the preview messaging answers {string} in the opening thread without naming anyone', async (world: MessagingWorld, content: string) => {
  const composite = registryOf(world).composite();
  const page = await composite.conversations();
  const conversationId = page.conversations[0]?.id ?? '';
  const result = await composite.send({ conversationId, recipients: [], content });
  scratchOf(world).conversationId = result.message.conversationId;
});

Then('the preview messaging thread has {int} received message(s)', async (world: MessagingWorld, count: number) => {
  const messages = await thread(world, scratchOf(world).conversationId ?? '');
  expect(messages.filter((message) => message.status === 'received')).toHaveLength(count);
});

When('the preview correspondent takes its time', async () => {
  await vi.advanceTimersByTimeAsync(1000);
});

Then('the preview messaging thread holds a reply from {string} saying {string}', async (world: MessagingWorld, from: string, content: string) => {
  const sender = { correspondent: PREVIEW_CORRESPONDENT, 'another account': OTHER }[from];
  const messages = await thread(world, scratchOf(world).conversationId ?? '');
  expect(messages.filter((message) => message.status === 'received').map((message) => [message.senderPubkey, message.content])).toContainEqual([sender, content]);
});
