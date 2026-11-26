import { createRelayEventResult, type RelayEventResult, type ServiceHandler } from '@kehto/runtime';
import { createOutboxService, type StreamingOutboxRouter } from '@kehto/services';
import type { createOutboxEventCache } from './outbox-event-cache.js';

type OutboxEventCache = ReturnType<typeof createOutboxEventCache>;
type PlannedSubscribe = NonNullable<StreamingOutboxRouter['subscribeWithPlan']>;
type Subscription = ReturnType<PlannedSubscribe>;
const MAX_DEDUP_IDS = 512;

interface PendingRead {
  closed: boolean;
  active?: Subscription;
}

interface OutboxReads {
  readonly router: StreamingOutboxRouter;
  readonly cache: OutboxEventCache;
}

function stop(read: PendingRead): void {
  read.closed = true;
  read.active?.close();
  delete read.active;
}

function replayedSubscription(options: OutboxReads, pending: PendingRead, observation: ReturnType<OutboxEventCache['open']>, args: Parameters<PlannedSubscribe>): Subscription {
  const [filters, plan, sink] = args;
  const isCurrent = () => !pending.closed;
  const seen = new Map<string, ReadonlySet<string>>();
  if (!isCurrent()) throw new Error('outbox subscription closed');
  for (const result of observation?.replay() ?? []) {
    seen.set(result.event.id, new Set(result.sidecar?.relayHints));
    sink.event(result);
    if (!isCurrent()) throw new Error('outbox subscription closed');
  }

  return options.router.subscribeWithPlan!(filters, plan, {
    ...sink,
    event(result) {
      if (!isCurrent()) return;
      observation?.observe(result);
      if (!observation) {
        sink.event(result);
        return;
      }
      const oldHints = seen.get(result.event.id);
      if (!oldHints) {
        if (seen.size < MAX_DEDUP_IDS) seen.set(result.event.id, new Set(result.sidecar?.relayHints?.map((hint) => hint.replace(/\/$/, ''))));
        sink.event(result);
        return;
      }
      const additional = result.sidecar?.relayHints?.filter((hint) => !oldHints.has(hint.replace(/\/$/, '')));
      if (!additional?.length) return;
      const relayHints = new Set([...oldHints, ...additional.map((hint) => hint.replace(/\/$/, ''))]);
      seen.set(result.event.id, relayHints);
      sink.event(createRelayEventResult(result.event, { ...result.sidecar, relayHints: [...relayHints] }));
    },
  });
}

function subscriptionRouter(options: OutboxReads, pending: PendingRead): StreamingOutboxRouter {
  const { router, cache } = options;
  let authors: readonly string[] | undefined;
  // Planning is per request. Author hints guide routing; don't replay anything beyond them.
  return {
    ...router,
    planRead(filters, readOptions) {
      authors = readOptions?.authors;
      return router.planRead!(filters, readOptions);
    },
    subscribeWithPlan(filters, plan, sink) {
      const observation = cache.open(filters, plan, authors);
      pending.active = replayedSubscription(options, pending, observation, [filters, plan, sink]);
      return { close: () => stop(pending) };
    },
  };
}

function newestFirst(a: RelayEventResult, b: RelayEventResult): number {
  return b.event.created_at - a.event.created_at || a.event.id.localeCompare(b.event.id);
}

function queryRouter(options: OutboxReads): StreamingOutboxRouter {
  const { router, cache } = options;
  return {
    ...router,
    async queryWithPlan(filters, readOptions, plan, signal) {
      const live = await router.queryWithPlan!(filters, readOptions, plan, signal);
      if (signal?.aborted || live.error === 'policy denied') return live;
      const observation = cache.open(filters, plan, readOptions?.authors);
      if (!observation?.canMergeQuery) return live;
      const cached = observation.replay();
      const merged = new Map(live.events.map((result) => [result.event.id, result]));
      for (const result of cached) {
        // The installed kehto planned query puts the whole plan in each sidecar, not the actual source.
        const current = merged.get(result.event.id);
        merged.set(result.event.id, current ? createRelayEventResult(current.event, { ...current.sidecar, ...result.sidecar }) : result);
      }
      const events = [...merged.values()];
      if (readOptions?.limit !== undefined || filters.some((filter) => filter.limit !== undefined)) events.sort(newestFirst);
      return { ...live, events: observation.limitQuery(events).slice(0, readOptions?.limit) };
    },
  };
}

/** kehto only registers the subscription once authorization finishes. Track the pending close too. */
export function createCachedOutboxService(options: OutboxReads): ServiceHandler {
  const pending = new Map<string, Map<string, PendingRead>>();
  let dispatching: PendingRead | undefined;
  function forget(windowId: string): void {
    pending.get(windowId)?.forEach(stop);
    pending.delete(windowId);
  }

  const service = createOutboxService({
    router: options.router,
    getReadRouter: () => dispatching ? subscriptionRouter(options, dispatching) : options.router,
    getQueryRouter: () => queryRouter(options),
  });
  return {
    ...service,
    handleMessage(windowId, message, send) {
      const subId = 'subId' in message ? message.subId : undefined;
      if ((message.type !== 'outbox.subscribe' && message.type !== 'outbox.close') || typeof subId !== 'string' || !subId) {
        service.handleMessage(windowId, message, send);
        return;
      }
      const reads = pending.get(windowId) ?? new Map<string, PendingRead>();
      const old = reads.get(subId);
      if (old) stop(old);
      reads.delete(subId);
      if (message.type === 'outbox.close') {
        if (reads.size === 0) pending.delete(windowId);
        service.handleMessage(windowId, message, send);
        return;
      }
      const read: PendingRead = { closed: false };
      reads.set(subId, read);
      pending.set(windowId, reads);
      dispatching = read;
      try {
        service.handleMessage(windowId, message, (response) => {
          if (read.closed) return;
          if (response.type === 'outbox.closed') {
            reads.delete(subId);
            if (reads.size === 0) pending.delete(windowId);
          }
          send(response);
        });
      } finally {
        dispatching = undefined;
      }
    },
    onWindowDestroyed(windowId) {
      forget(windowId);
      service.onWindowDestroyed?.(windowId);
    },
    onCapabilityRevoked(windowId, capability) {
      if (capability === null || capability === 'outbox:read') forget(windowId);
      service.onCapabilityRevoked?.(windowId, capability);
    },
    onPermissionRevoked(windowId) {
      forget(windowId);
      service.onPermissionRevoked?.(windowId);
    },
    onUnregistered() {
      for (const windowId of pending.keys()) forget(windowId);
      options.cache.persist();
      service.onUnregistered?.();
    },
  };
}
