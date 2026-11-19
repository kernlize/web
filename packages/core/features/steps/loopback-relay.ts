import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { NostrEvent, NostrFilter } from '@napplet/core';

/**
 * A relay on a loopback port that keeps what it is sent: it answers a REQ with
 * the stored events that match, then EOSE, then streams new matches until the
 * subscription closes. Real sockets, real frames; nothing leaves the machine.
 */
export interface LoopbackRelay {
  readonly url: string;
  /** Every event published to it, in arrival order, refused ones included. */
  readonly published: NostrEvent[];
  /** While true, every publish is answered `OK false` and kept nowhere. */
  refusing: boolean;
  /** Store an event as if it had been published, and deliver it to open subscriptions. */
  store(event: NostrEvent): void;
  /** Called for every event a client publishes. */
  onPublish(listener: (event: NostrEvent) => void): void;
  close(): Promise<void>;
}

type TaggedFilter = NostrFilter & Record<`#${string}`, string[] | undefined>;

/**
 * Whether an event matches a filter: ids, kinds, authors, since and single-letter tags.
 *
 * @param filter - A REQ filter.
 * @param event - A stored or published event.
 * @returns True when every constraint the filter sets holds.
 * @example
 * ```ts
 * matchesFilter({ kinds: [1], '#p': [me] }, event);
 * ```
 */
export function matchesFilter(filter: NostrFilter, event: NostrEvent): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  return Object.entries(filter as TaggedFilter).every(([key, values]) => {
    if (!key.startsWith('#') || !Array.isArray(values)) return true;
    return event.tags.some((tag) => tag[0] === key.slice(1) && values.includes(tag[1] ?? ''));
  });
}

/**
 * Start a {@link LoopbackRelay}.
 *
 * @returns The running relay.
 * @example
 * ```ts
 * const relay = await startLoopbackRelay();
 * relay.onPublish((event) => console.log(event.kind));
 * ```
 */
export function startLoopbackRelay(): Promise<LoopbackRelay> {
  const stored: NostrEvent[] = [];
  const published: NostrEvent[] = [];
  const listeners: Array<(event: NostrEvent) => void> = [];
  const subscriptions = new Map<WebSocket, Map<string, NostrFilter[]>>();
  const deliver = (event: NostrEvent): void => {
    for (const [socket, subs] of subscriptions) {
      for (const [subId, filters] of subs) {
        if (filters.some((filter) => matchesFilter(filter, event))) socket.send(JSON.stringify(['EVENT', subId, event]));
      }
    }
  };
  const store = (event: NostrEvent): void => {
    stored.push(event);
    deliver(event);
  };
  const serve = (socket: WebSocket): void => {
    const subs = new Map<string, NostrFilter[]>();
    subscriptions.set(socket, subs);
    socket.on('close', () => subscriptions.delete(socket));
    socket.on('message', (raw) => {
      const [verb, first, ...rest] = JSON.parse(String(raw)) as [string, unknown, ...NostrFilter[]];
      if (verb === 'EVENT') {
        const event = first as NostrEvent;
        published.push(event);
        socket.send(JSON.stringify(['OK', event.id, !relay.refusing, relay.refusing ? 'blocked: not now' : '']));
        if (relay.refusing) return;
        store(event);
        for (const listener of listeners) listener(event);
        return;
      }
      if (verb === 'CLOSE') {
        subs.delete(first as string);
        return;
      }
      if (verb !== 'REQ') return;
      const subId = first as string;
      for (const event of stored) if (rest.some((filter) => matchesFilter(filter, event))) socket.send(JSON.stringify(['EVENT', subId, event]));
      socket.send(JSON.stringify(['EOSE', subId]));
      subs.set(subId, rest);
    });
  };
  const http = createServer();
  const sockets = new WebSocketServer({ noServer: true });
  const relay: LoopbackRelay = {
    url: '',
    published,
    refusing: false,
    store,
    onPublish: (listener) => void listeners.push(listener),
    close: () => new Promise<void>((done) => {
      for (const client of sockets.clients) client.terminate();
      http.closeAllConnections();
      http.close(() => done());
    }),
  };
  return new Promise((resolve) => {
    http.on('upgrade', (request, socket, head) => sockets.handleUpgrade(request, socket, head, serve));
    http.listen(0, '127.0.0.1', () => {
      const { port } = http.address() as AddressInfo;
      Object.assign(relay, { url: `ws://127.0.0.1:${port}` });
      resolve(relay);
    });
  });
}
