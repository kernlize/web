import { describe, expect, it } from 'vitest';
import type { HandlerDefaults } from './defaults.js';
import type { InstalledApplets } from './installed.js';
import { createIntentRouter } from './router.js';

describe('createIntentRouter without a chooser', () => {
  it('returns the refusal when nothing handles the request, without offering a store search', async () => {
    const installed = { catalog: () => [], get: () => undefined } as unknown as InstalledApplets;
    const defaults = { get: () => undefined, synced: () => undefined, set: async () => undefined } as unknown as HandlerDefaults;
    const router = createIntentRouter({ installed, defaults, describeSender: () => 'Sender', deliver: async () => undefined });
    const request = { archetype: 'note', action: 'open', convention: 'napplet:note/open', payload: {} } as unknown as Parameters<typeof router.invoke>[0];
    const result = await router.invoke(request, { sender: 'sender-1' } as Parameters<typeof router.invoke>[1]);
    expect(result).toMatchObject({ ok: false, error: 'no handler' });
  });
});
