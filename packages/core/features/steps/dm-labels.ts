import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { DmAdapter } from '@kehto/services';
import type { DmConversation, DmConversationPage } from '@napplet/core';
import { labelConversations, type ProfileCard } from '@kernlize/core';
import { scratch, splitList, type CoreWorld } from './world.js';

interface LabelScratch {
  adapter: DmAdapter;
  names: Map<string, string>;
  page?: DmConversationPage;
}

const l = (world: CoreWorld): LabelScratch => scratch(world).labels as LabelScratch;

function participant(spec: string): { pubkey: string; label?: string } {
  const [pubkey = '', label] = spec.split('=');
  return label === undefined ? { pubkey } : { pubkey, label };
}

Given('a conversation adapter listing a conversation with {string}', (world: CoreWorld, specs: string) => {
  const conversation: DmConversation = { id: 'c1', kind: 'direct', participants: splitList(specs).map(participant), unread: 0 };
  const adapter: DmAdapter = {
    status: () => ({ available: true }) as never,
    conversations: async () => ({ conversations: [conversation] }) as DmConversationPage,
    messages: () => ({ messages: [] }) as never,
    send: async () => ({ ok: true }) as never,
    subscribe: () => ({ subscriptionId: 's1' }) as never,
    unsubscribe: () => ({ ok: true }) as never,
  };
  scratch(world).labels = { adapter, names: new Map() } satisfies LabelScratch;
});

Given('profiles naming {string} as {string} and {string} as {string}', (world: CoreWorld, a: string, aName: string, b: string, bName: string) => {
  l(world).names.set(a, aName).set(b, bName);
});

When('the shell lists conversations through the naming adapter', async (world: CoreWorld) => {
  const { names } = l(world);
  const settled = async (pubkey: string): Promise<ProfileCard> => {
    const name = names.get(pubkey);
    return name === undefined ? { pubkey, name: pubkey, found: false } : { pubkey, name, found: true };
  };
  l(world).adapter = labelConversations(l(world).adapter, { settled });
  l(world).page = await l(world).adapter.conversations({});
});

Then('the participants are {string}', (world: CoreWorld, specs: string) => {
  expect(l(world).page?.conversations[0]?.participants).toEqual(splitList(specs).map(participant));
});

Then('the naming adapter still answers status, messages, send and subscriptions as the backend does', async (world: CoreWorld) => {
  const { adapter } = l(world);
  expect(adapter.status()).toEqual({ available: true });
  expect(adapter.messages({ conversationId: 'c1' } as never)).toEqual({ messages: [] });
  expect(await adapter.send({} as never)).toEqual({ ok: true });
  expect(adapter.subscribe({} as never, () => undefined)).toEqual({ subscriptionId: 's1' });
  expect(adapter.unsubscribe('s1')).toEqual({ ok: true });
});
