import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { DmConversationPage } from '@napplet/core';
import { createCompositeBackend, createMemoryBackend, type MemoryBackend, type MessagingBackend } from '@kernl/messaging';
import { attempt, list, state, type MessagingWorld } from './world.js';

function memory(world: MessagingWorld, id: string): MemoryBackend {
  const backend = state(world).memory.get(id);
  if (!backend || !('deliver' in backend)) throw new Error(`no memory backend ${id}`);
  return backend as MemoryBackend;
}

function composite(world: MessagingWorld): MessagingBackend {
  const backend = state(world).composite;
  if (!backend) throw new Error('no composite');
  return backend;
}

function stubBackend(): MessagingBackend {
  const page: DmConversationPage = {
    conversations: [
      { id: 'idle', kind: 'direct', participants: [], unread: 0 },
      { id: 'idle-2', kind: 'direct', participants: [], unread: 0 },
    ],
  };
  return {
    status: () => ({ available: false, implementations: [], capabilities: [] }),
    conversations: () => page,
    messages: () => ({ messages: [] }),
    send: () => Promise.reject(new Error('unavailable:stub')),
    subscribe: () => ({ subscriptionId: 'stub' }),
    unsubscribe: () => ({ ok: true }),
  };
}

Given('memory messaging backends {string} owned by {string}', (world: MessagingWorld, ids: string, owner: string) => {
  const s = state(world);
  for (const id of list(ids)) s.memory.set(id, createMemoryBackend({ owner, now: () => 0 }));
});

Given('memory messaging backend {string} is offline', (world: MessagingWorld, id: string) => {
  state(world).memory.set(id, createMemoryBackend({ owner: 'me', available: false }));
});

Given('a stub messaging backend {string} whose conversations have no activity', (world: MessagingWorld, id: string) => {
  state(world).memory.set(id, stubBackend());
});

Given('a messaging composite over providers {string}', (world: MessagingWorld, ids: string) => {
  const s = state(world);
  s.enabled = list(ids).map((id) => {
    const backend = s.memory.get(id);
    if (!backend) throw new Error(`no backend ${id}`);
    return { id, backend };
  });
  s.composite = createCompositeBackend(
    () => s.enabled,
    () => s.defaultId,
  );
});

Given('the messaging composite default is {string}', (world: MessagingWorld, id: string) => {
  state(world).defaultId = id;
});

Given(
  'memory messaging backend {string} received {string} from {string} at {int}',
  (world: MessagingWorld, id: string, content: string, senderPubkey: string, createdAt: number) => {
    memory(world, id).deliver({ senderPubkey, content, createdAt });
  },
);

When('memory messaging backend {string} is closed', (world: MessagingWorld, id: string) => {
  memory(world, id).close();
});

When('messaging composite provider {string} is removed', (world: MessagingWorld, id: string) => {
  const s = state(world);
  s.enabled = s.enabled.filter((entry) => entry.id !== id);
});

Then('the composite messaging status is unavailable without owner', async (world: MessagingWorld) => {
  const status = await composite(world).status();
  expect(status.available).toBe(false);
  expect(status.ownerPubkey).toBeUndefined();
  state(world).status = status;
});

Then('the composite messaging status is available with owner {string}', async (world: MessagingWorld, owner: string) => {
  const status = await composite(world).status();
  expect(status.available).toBe(true);
  expect(status.ownerPubkey).toBe(owner);
  state(world).status = status;
});

Then('the composite status implementations are {string}', (world: MessagingWorld, expected: string) => {
  expect(state(world).status?.implementations).toEqual(list(expected));
});

Then('the composite status capabilities are {string}', (world: MessagingWorld, expected: string) => {
  expect(state(world).status?.capabilities).toEqual(list(expected));
});

When('I list composite messaging conversations', (world: MessagingWorld) =>
  attempt(world, async () => {
    state(world).conversationPage = await composite(world).conversations();
  }),
);

When('I list composite messaging conversations with limit {int}', (world: MessagingWorld, limit: number) =>
  attempt(world, async () => {
    state(world).conversationPage = await composite(world).conversations({ limit });
  }),
);

When('I list composite messaging conversations from cursor {string}', (world: MessagingWorld, cursor: string) =>
  attempt(world, async () => {
    state(world).conversationPage = await composite(world).conversations({ cursor });
  }),
);

Then('the composite conversation ids are {string}', (world: MessagingWorld, expected: string) => {
  expect(state(world).conversationPage?.conversations.map((conversation) => conversation.id)).toEqual(list(expected));
});

Then('the composite conversation page has no cursor', (world: MessagingWorld) => {
  expect(state(world).conversationPage?.cursor).toBeUndefined();
});

Then('the composite conversation cursor is {string}', (world: MessagingWorld, cursor: string) => {
  expect(state(world).conversationPage?.cursor).toBe(cursor);
});

When('I list composite messaging messages in {string}', (world: MessagingWorld, conversationId: string) =>
  attempt(world, async () => {
    state(world).messagePage = await composite(world).messages({ conversationId });
  }),
);

Then('the composite message ids are {string}', (world: MessagingWorld, expected: string) => {
  expect(state(world).messagePage?.messages.map((message) => message.id)).toEqual(list(expected));
});

Then('every composite message belongs to conversation {string}', (world: MessagingWorld, conversationId: string) => {
  const page = state(world).messagePage;
  expect(page?.messages.length).toBeGreaterThan(0);
  for (const message of page?.messages ?? []) expect(message.conversationId).toBe(conversationId);
});

When(
  'I send {string} to {string} in composite conversation {string}',
  (world: MessagingWorld, content: string, recipient: string, conversationId: string) =>
    attempt(world, async () => {
      state(world).sendResult = await composite(world).send({ conversationId, recipients: [recipient], content });
    }),
);

When(
  'I send {string} to {string} through composite provider {string}',
  (world: MessagingWorld, content: string, recipient: string, provider: string) =>
    attempt(world, async () => {
      state(world).sendResult = await composite(world).send({ recipients: [recipient], content, provider });
    }),
);

When('I send {string} to {string} with the composite', (world: MessagingWorld, content: string, recipient: string) =>
  attempt(world, async () => {
    state(world).sendResult = await composite(world).send({ recipients: [recipient], content });
  }),
);

Then(
  'the composite send result has id {string} in conversation {string}',
  (world: MessagingWorld, id: string, conversationId: string) => {
    const result = state(world).sendResult;
    expect(result?.ok).toBe(true);
    expect(result?.message.id).toBe(id);
    expect(result?.message.conversationId).toBe(conversationId);
  },
);

Then(
  'memory messaging backend {string} holds {int} messages in {string}',
  (world: MessagingWorld, id: string, count: number, conversationId: string) => {
    expect(memory(world, id).messages({ conversationId }).messages).toHaveLength(count);
  },
);

When('I subscribe to all composite messaging conversations', async (world: MessagingWorld) => {
  const s = state(world);
  const sub = await composite(world).subscribe({}, (message) => s.delivered.push(message));
  s.subscriptionId = sub.subscriptionId;
});

When('I subscribe to composite messaging conversation {string}', async (world: MessagingWorld, conversationId: string) => {
  const s = state(world);
  const sub = await composite(world).subscribe({ conversationId }, (message) => s.delivered.push(message));
  s.subscriptionId = sub.subscriptionId;
});

When('I unsubscribe the composite messaging subscription', async (world: MessagingWorld) => {
  const s = state(world);
  s.unsubscribeResult = await composite(world).unsubscribe(s.subscriptionId ?? '');
});

When('I unsubscribe composite messaging subscription {string}', async (world: MessagingWorld, id: string) => {
  state(world).unsubscribeResult = await composite(world).unsubscribe(id);
});

Then('the composite delivered message ids are {string}', (world: MessagingWorld, expected: string) => {
  expect(state(world).delivered.map((message) => message.id)).toEqual(list(expected));
});

Then('the composite delivered conversation ids are {string}', (world: MessagingWorld, expected: string) => {
  expect(state(world).delivered.map((message) => message.conversationId)).toEqual(list(expected));
});

Then('the composite unsubscribe result is ok', (world: MessagingWorld) => {
  expect(state(world).unsubscribeResult).toEqual({ ok: true });
});

Then('the composite unsubscribe result is not ok', (world: MessagingWorld) => {
  expect(state(world).unsubscribeResult).toEqual({ ok: false });
});

When('I close the messaging composite', (world: MessagingWorld) => {
  composite(world).close?.();
});
