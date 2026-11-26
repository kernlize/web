import { createRelayEventResultWithHints, type RelayEventResult, type ServiceRuntimeContext } from '@kehto/runtime';
import type { OutboxRelayPlan, StreamingOutboxRouter } from '@kehto/services';
import { finalizeEvent } from 'applesauce-core/helpers';
import type { NappletMessage } from '@napplet/core';
import { expect, it, vi } from 'vitest';
import { createOutboxEventCache } from './outbox-event-cache.js';
import { createCachedOutboxService } from './outbox-reads.js';

it('bounds deduplication state and ignores a callback that arrives after close', async () => {
  const relay = 'wss://nos.lol';
  const plan: OutboxRelayPlan = { relays: [relay], source: 'policy' };
  const send = vi.fn();
  const close = vi.fn();
  const event = finalizeEvent({ kind: 31971, content: '', tags: [], created_at: 1 }, new Uint8Array(32).fill(1));
  let deliver: ((event: RelayEventResult) => void) | undefined;
  const router = {
    async planRead() { return plan; },
    subscribeWithPlan(_filters, _plan, sink) {
      deliver = sink.event;
      return { close };
    },
  } satisfies Pick<StreamingOutboxRouter, 'planRead' | 'subscribeWithPlan'>;
  const cache = createOutboxEventCache({ getItem: () => null, setItem() {}, removeItem() {} });
  const service = createCachedOutboxService({ router: router as StreamingOutboxRouter, cache });
  const signal = new AbortController().signal;
  service.onRegistered?.({ authorizeOperation: async (_window, _operation, _requirements, execute) => ({ status: 'executed', value: await execute(signal) }) } as ServiceRuntimeContext);
  service.handleMessage('w', { type: 'outbox.subscribe', subId: 'tree', filters: [{ kinds: [31971] }] } as NappletMessage, send);
  await vi.waitFor(() => expect(deliver).toBeTypeOf('function'));
  // This is a router double: signature admission belongs to the router, not this lifecycle guard.
  for (let i = 0; i < 513; i++) deliver!(createRelayEventResultWithHints({ ...event, id: String(i) }, [relay]));
  expect(send).toHaveBeenCalledTimes(513);
  service.handleMessage('w', { type: 'outbox.close', subId: 'tree' } as NappletMessage, send);
  deliver!(createRelayEventResultWithHints(event, [relay]));
  expect(close).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledTimes(514);
  service.onUnregistered?.();
});

it.each(['unsupported limited filter', 'empty cache', 'policy denied'] as const)('preserves the relay response for %s', async (reason) => {
  const plan: OutboxRelayPlan = { relays: ['wss://nos.lol'], source: 'policy' };
  const tree = { kinds: [31971] };
  const cache = createOutboxEventCache();
  const cached = finalizeEvent({ kind: 31971, content: '', tags: [], created_at: 1 }, new Uint8Array(32).fill(1));
  if (reason !== 'empty cache') cache.open([tree], plan, undefined)!.observe(createRelayEventResultWithHints(cached, plan.relays));
  const reply = reason === 'policy denied' ? { events: [], error: 'policy denied' as const } : { events: [], incomplete: true };
  const router = { async planRead() { return plan; }, async queryWithPlan() { return reply; } };
  const service = createCachedOutboxService({ router: router as StreamingOutboxRouter, cache });
  const signal = new AbortController().signal;
  service.onRegistered?.({ authorizeOperation: async (_win, _op, _req, execute) => ({ status: 'executed', value: await execute(signal) }) } as ServiceRuntimeContext);
  const send = vi.fn();
  const filters = reason === 'unsupported limited filter' ? [{ ...tree, limit: 1 }, { search: 'tree' }] : [tree];
  service.handleMessage('w', { type: 'outbox.query', id: 'q', filters } as NappletMessage, send);
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'outbox.query.result', id: 'q', ...reply }));
});
