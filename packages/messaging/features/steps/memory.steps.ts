import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createMemoryBackend, type MemoryBackend } from '@kernlize/messaging';
import { attempt, list, state, type MessagingWorld } from './world.js';

function backend(world: MessagingWorld): MemoryBackend {
  const current = state(world).backend;
  if (!current) throw new Error('no memory backend');
  return current;
}

Given('a memory messaging backend owned by {string} at time {int}', (world: MessagingWorld, owner: string, time: number) => {
  state(world).backend = createMemoryBackend({ owner, now: () => time });
});

Given('a memory messaging backend with default options', (world: MessagingWorld) => {
  state(world).backend = createMemoryBackend();
});

Given('a memory messaging backend that is offline', (world: MessagingWorld) => {
  state(world).backend = createMemoryBackend({ owner: 'me', available: false });
});

Then('the memory backend status is available with owner {string}', (world: MessagingWorld, owner: string) => {
  expect(backend(world).status()).toMatchObject({ available: true, ownerPubkey: owner });
});

Then('the memory backend status is unavailable', (world: MessagingWorld) => {
  expect(backend(world).status()).toMatchObject({ available: false });
});

Then('the memory backend status implementations are {string}', (world: MessagingWorld, expected: string) => {
  expect(backend(world).status().implementations).toEqual(list(expected));
});

When('I send {string} to {string} on the memory backend', (world: MessagingWorld, content: string, recipients: string) =>
  attempt(world, async () => {
    state(world).sendResult = await backend(world).send({ recipients: list(recipients), content });
  }),
);

When(
  'I send {string} to {string} with client id {string} on the memory backend',
  (world: MessagingWorld, content: string, recipients: string, clientMessageId: string) =>
    attempt(world, async () => {
      state(world).sendResult = await backend(world).send({ recipients: list(recipients), content, clientMessageId });
    }),
);

When('I send {string} into memory conversation {string}', (world: MessagingWorld, content: string, conversationId: string) =>
  attempt(world, async () => {
    state(world).sendResult = await backend(world).send({ conversationId, recipients: [], content });
  }),
);

When(
  'the memory backend receives {string} from {string} at {int}',
  (world: MessagingWorld, content: string, senderPubkey: string, createdAt: number) => {
    backend(world).deliver({ senderPubkey, content, createdAt });
  },
);

When(
  'the memory backend receives {string} from {string} in conversation {string}',
  (world: MessagingWorld, content: string, senderPubkey: string, conversationId: string) => {
    backend(world).deliver({ senderPubkey, content, conversationId });
  },
);

Then(
  'the memory send result has id {string} in {string} with status {string} from {string} at {int}',
  (world: MessagingWorld, id: string, conversationId: string, status: string, senderPubkey: string, createdAt: number) => {
    expect(state(world).sendResult).toEqual({
      ok: true,
      message: { id, conversationId, status, senderPubkey, createdAt, content: expect.any(String) },
    });
  },
);

Then('the memory send result is from {string} with a wall-clock time', (world: MessagingWorld, senderPubkey: string) => {
  const message = state(world).sendResult?.message;
  expect(message?.senderPubkey).toBe(senderPubkey);
  expect(message?.createdAt).toBeGreaterThan(1_700_000_000);
});

When('I list memory conversations with limit {int}', (world: MessagingWorld, limit: number) => {
  state(world).conversationPage = backend(world).conversations({ limit });
});

When('I list memory conversations from cursor {string} with limit {int}', (world: MessagingWorld, cursor: string, limit: number) => {
  state(world).conversationPage = backend(world).conversations({ cursor, limit });
});

Then('the memory conversations are {string}', (world: MessagingWorld, expected: string) => {
  const s = state(world);
  s.conversationPage ??= backend(world).conversations();
  expect(s.conversationPage.conversations.map((conversation) => conversation.id)).toEqual(list(expected));
  s.conversationPage = undefined;
});

Then('the memory conversation cursor is {string}', (world: MessagingWorld, cursor: string) => {
  expect(backend(world).conversations({ limit: 2 }).cursor).toBe(cursor);
});

Then('the memory conversation page has no cursor', (world: MessagingWorld) => {
  expect(backend(world).conversations({ cursor: '2', limit: 2 }).cursor).toBeUndefined();
});

Then(
  'memory conversation {string} is {string} with participants {string} and {int} unread',
  (world: MessagingWorld, id: string, kind: string, participants: string, unread: number) => {
    const conversation = backend(world).conversations().conversations.find((entry) => entry.id === id);
    expect(conversation).toMatchObject({ kind, unread, participants: list(participants).map((pubkey) => ({ pubkey })) });
  },
);

Then('memory conversation {string} was updated at {int}', (world: MessagingWorld, id: string, updatedAt: number) => {
  const conversation = backend(world).conversations().conversations.find((entry) => entry.id === id);
  expect(conversation?.updatedAt).toBe(updatedAt);
});

Then('memory conversation {string} holds {int} messages', (world: MessagingWorld, conversationId: string, count: number) => {
  expect(backend(world).messages({ conversationId }).messages).toHaveLength(count);
});

Then('the memory message ids in {string} are {string}', (world: MessagingWorld, conversationId: string, expected: string) => {
  expect(backend(world).messages({ conversationId }).messages.map((message) => message.id)).toEqual(list(expected));
});

Then(
  'the memory message {string} in {string} has status {string} from {string}',
  (world: MessagingWorld, id: string, conversationId: string, status: string, senderPubkey: string) => {
    const message = backend(world).messages({ conversationId }).messages.find((entry) => entry.id === id);
    expect(message).toMatchObject({ status, senderPubkey });
  },
);

When('I list memory messages in {string}', (world: MessagingWorld, conversationId: string) => {
  state(world).messagePage = backend(world).messages({ conversationId });
});

When('I list memory messages in {string} with limit {int}', (world: MessagingWorld, conversationId: string, limit: number) => {
  state(world).messagePage = backend(world).messages({ conversationId, limit });
});

When(
  'I list memory messages in {string} from cursor {string} with limit {int}',
  (world: MessagingWorld, conversationId: string, cursor: string, limit: number) => {
    state(world).messagePage = backend(world).messages({ conversationId, cursor, limit });
  },
);

Then('the memory message ids are {string}', (world: MessagingWorld, expected: string) => {
  expect(state(world).messagePage?.messages.map((message) => message.id)).toEqual(list(expected));
});

Then('the memory message cursor is {string}', (world: MessagingWorld, cursor: string) => {
  expect(state(world).messagePage?.cursor).toBe(cursor);
});

Then('the memory message page has no cursor', (world: MessagingWorld) => {
  expect(state(world).messagePage?.cursor).toBeUndefined();
});

When('I subscribe to all memory messaging conversations', (world: MessagingWorld) => {
  const s = state(world);
  s.subscriptionId = backend(world).subscribe({}, (message) => s.delivered.push(message)).subscriptionId;
});

When('I subscribe to memory messaging conversation {string}', (world: MessagingWorld, conversationId: string) => {
  const s = state(world);
  s.subscriptionId = backend(world).subscribe({ conversationId }, (message) => s.delivered.push(message)).subscriptionId;
});

When('I unsubscribe the memory messaging subscription', (world: MessagingWorld) => {
  const s = state(world);
  s.unsubscribeResult = backend(world).unsubscribe(s.subscriptionId ?? '');
});

When('I unsubscribe memory messaging subscription {string}', (world: MessagingWorld, id: string) => {
  state(world).unsubscribeResult = backend(world).unsubscribe(id);
});

Then('the memory delivered message ids are {string}', (world: MessagingWorld, expected: string) => {
  expect(state(world).delivered.map((message) => message.id)).toEqual(list(expected));
});

Then('the memory unsubscribe result is ok', (world: MessagingWorld) => {
  expect(state(world).unsubscribeResult).toEqual({ ok: true });
});

Then('the memory unsubscribe result is not ok', (world: MessagingWorld) => {
  expect(state(world).unsubscribeResult).toEqual({ ok: false });
});

When('I close the memory backend', (world: MessagingWorld) => {
  backend(world).close();
});
