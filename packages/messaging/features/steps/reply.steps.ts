import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { DmConversation, DmMessage } from '@napplet/core';
import { createCompositeBackend, createMessagingRegistry, type MemoryBackend, type MessagingBackend, type ReplyRule } from '@kernlize/messaging';
import { attempt, list, state, type MessagingWorld } from './world.js';

const OWNER = 'me';

function memory(world: MessagingWorld, id: string): MemoryBackend {
  return state(world).memory.get(id) as MemoryBackend;
}

function registryBackend(world: MessagingWorld, id: string): MemoryBackend {
  return state(world).fakes.get(id)?.backend as MemoryBackend;
}

/** A backend with scripted conversations and messages, whose sends always fail the way `refusal` says. */
function scripted(parts: Partial<MessagingBackend>, refusal = 'unavailable:stub'): MessagingBackend {
  return {
    status: () => ({ available: true, ownerPubkey: OWNER, implementations: [], capabilities: [] }),
    conversations: () => ({ conversations: [] }),
    messages: () => ({ messages: [] }),
    send: () => Promise.reject(new Error(refusal)),
    subscribe: () => ({ subscriptionId: 'scripted' }),
    unsubscribe: () => ({ ok: true }),
    ...parts,
  };
}

const withBob = (peer: string, updatedAt?: number): DmConversation => ({
  id: `direct:${peer}`,
  kind: 'direct',
  participants: [{ pubkey: peer }],
  unread: 0,
  ...(updatedAt === undefined ? {} : { updatedAt }),
});

const from = (peer: string, createdAt: number): DmMessage => ({
  id: `m-${createdAt}`,
  conversationId: `direct:${peer}`,
  senderPubkey: peer,
  createdAt,
  content: 'hi',
  status: 'received',
});

Given('a messaging backend {string} that cannot reach anyone', (world: MessagingWorld, id: string) => {
  state(world).memory.set(id, scripted({}, `unavailable:recipient-not-ready ${id}`));
});

Given('a messaging backend {string} whose conversation with {string} at {int} cannot be read', (world: MessagingWorld, id: string, peer: string, updatedAt: number) => {
  state(world).memory.set(
    id,
    scripted({
      conversations: () => ({ conversations: [withBob(peer, updatedAt)] }),
      messages: () => {
        throw new Error('read a conversation with nothing newer');
      },
    }),
  );
});

Given('a messaging backend {string} whose conversation with {string} holds a message at {int}', (world: MessagingWorld, id: string, peer: string, createdAt: number) => {
  state(world).memory.set(id, scripted({ conversations: () => ({ conversations: [withBob(peer)] }), messages: () => ({ messages: [from(peer, createdAt)] }) }));
});

Given('a messaging backend {string} whose conversation pages never end', (world: MessagingWorld, id: string) => {
  state(world).memory.set(id, scripted({ conversations: () => ({ conversations: [], cursor: 'more' }) }));
});

Given('a messaging backend {string} whose message pages never end for {string}', (world: MessagingWorld, id: string, peer: string) => {
  state(world).memory.set(id, scripted({ conversations: () => ({ conversations: [withBob(peer, 900)] }), messages: () => ({ messages: [], cursor: 'more' }) }));
});

Given('a messaging composite over providers {string} that follows the correspondent', (world: MessagingWorld, ids: string) => {
  const s = state(world);
  s.enabled = list(ids).map((id) => ({ id, backend: s.memory.get(id) as MessagingBackend }));
  s.composite = createCompositeBackend(
    () => s.enabled,
    () => s.defaultId,
    {
      chooseReply(choice) {
        s.replyChoices.push(choice);
        return choice.theirs;
      },
    },
  );
});

Given('memory messaging backend {string} holds my message {string} to {string}', async (world: MessagingWorld, id: string, content: string, recipients: string) => {
  await memory(world, id).send({ recipients: list(recipients), content });
});

Given('memory messaging backend {string} received {int} messages from other people', (world: MessagingWorld, id: string, count: number) => {
  for (let index = 0; index < count; index += 1) memory(world, id).deliver({ senderPubkey: `person-${index}`, content: 'hi', createdAt: 5000 + index });
});

Given(
  'memory messaging backend {string} received {int} messages from {string} starting at {int}',
  (world: MessagingWorld, id: string, count: number, senderPubkey: string, start: number) => {
    for (let index = 0; index < count; index += 1) memory(world, id).deliver({ senderPubkey, content: 'hi', createdAt: start + index });
  },
);

When('I send {string} as {string} in composite conversation {string}', (world: MessagingWorld, content: string, clientMessageId: string, conversationId: string) =>
  attempt(world, async () => {
    state(world).sendResult = await state(world).composite?.send({ conversationId, recipients: [], content, clientMessageId });
  }),
);

When('I send {string} to the people {string} with the composite', (world: MessagingWorld, content: string, recipients: string) =>
  attempt(world, async () => {
    state(world).sendResult = await state(world).composite?.send({ recipients: list(recipients), content });
  }),
);

Then('the reply choice was {string} theirs {string} mine {string}', (world: MessagingWorld, peer: string, theirs: string, mine: string) => {
  expect(state(world).replyChoices).toEqual([{ peer: { pubkey: peer }, theirs, mine }]);
});

Then('no reply choice was offered', (world: MessagingWorld) => {
  expect(state(world).replyChoices).toEqual([]);
});

Given('a messaging registry that asks about replies', (world: MessagingWorld) => {
  const s = state(world);
  s.registry = createMessagingRegistry({
    onChange: (prefs) => s.notifications.push(prefs),
    askReply: async (prompt) => {
      s.replyPrompts.push(prompt);
      return s.replyAnswer;
    },
  });
});

Given('a messaging registry restoring the reply rule {string} and choices {string}', (world: MessagingWorld, rule: string, choices: string) => {
  const replyChoices = Object.fromEntries(list(choices).map((pair) => pair.split('='))) as Record<string, 'theirs' | 'mine'>;
  state(world).registry = createMessagingRegistry({ preferences: { enabled: [], reply: rule as ReplyRule, replyChoices } });
});

Given("the registry's {string} backend received {string} from {string} at {int}", (world: MessagingWorld, id: string, content: string, senderPubkey: string, createdAt: number) => {
  registryBackend(world, id).deliver({ senderPubkey, content, createdAt });
});

Given('the user will answer the reply question with {string} for {string}', (world: MessagingWorld, use: string, remember: string) => {
  state(world).replyAnswer = { use: use as 'theirs' | 'mine', remember: remember as 'once' | 'conversation' | 'always' };
});

Given('the user will dismiss the reply question', (world: MessagingWorld) => {
  delete state(world).replyAnswer;
});

When('I set the messaging reply rule to {string}', (world: MessagingWorld, rule: string) => {
  state(world).registry?.setReplyRule(rule as ReplyRule);
});

When('I forget the messaging reply choice for {string}', (world: MessagingWorld, pubkey: string) => {
  state(world).registry?.forgetReplyChoice(pubkey);
});

When('I forget every messaging reply choice', (world: MessagingWorld) => {
  state(world).registry?.forgetReplyChoice();
});

Then('the reply question was asked {int} time(s)', (world: MessagingWorld, count: number) => {
  expect(state(world).replyPrompts).toHaveLength(count);
});

Then('the reply question named {string}, theirs {string} and mine {string}', (world: MessagingWorld, peer: string, theirs: string, mine: string) => {
  const prompt = state(world).replyPrompts[0];
  expect(prompt?.peer).toEqual({ pubkey: peer });
  expect(prompt?.theirs.name).toBe(theirs);
  expect(prompt?.mine.name).toBe(mine);
});

Then('the messaging reply rule is {string}', (world: MessagingWorld, rule: string) => {
  expect(state(world).registry?.preferences().reply).toBe(rule);
});

Then('the messaging reply choices are {string}', (world: MessagingWorld, choices: string) => {
  expect(state(world).registry?.preferences().replyChoices).toEqual(Object.fromEntries(list(choices).map((pair) => pair.split('='))));
});

Then("the registry's {string} backend holds {int} messages in {string}", (world: MessagingWorld, id: string, count: number, conversationId: string) => {
  expect(registryBackend(world, id).messages({ conversationId }).messages).toHaveLength(count);
});
