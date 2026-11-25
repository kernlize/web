import { matchFilters, type Filter, type NostrEvent } from 'applesauce-core/helpers';
import type { RelayPoolOptions } from 'applesauce-relay';

/** The WebSocket constructor applesauce's relays dial through. */
export type RelaySocketConstructor = NonNullable<RelayPoolOptions['WebSocket']>;

/** Relays that live in the page: one store every URL answers from (#75). */
export interface MemoryRelays {
  /** Hand to `new RelayPool({ WebSocket })`: every relay it dials answers from memory. */
  readonly WebSocket: RelaySocketConstructor;
  /** Put events on the relays before anything asks, as if they were already published. */
  seed(...events: readonly NostrEvent[]): void;
  /** What the relays hold now, newest first. */
  events(): readonly NostrEvent[];
}

/** What {@link createMemoryRelays} takes. */
export interface MemoryRelaysOptions {
  /** Relays that refuse every event, answering `OK false`. */
  readonly refusing?: readonly string[];
}

const OPEN = 1;
const CLOSED = 3;

const isReplaceable = (kind: number): boolean => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000);
const isAddressable = (kind: number): boolean => kind >= 30000 && kind < 40000;
const isEphemeral = (kind: number): boolean => kind >= 20000 && kind < 30000;

/** NIP-01: a replaceable or addressable event takes the place of the one it replaces. */
function slotOf(event: NostrEvent): string {
  if (isReplaceable(event.kind)) return `${event.kind}:${event.pubkey}`;
  if (isAddressable(event.kind)) return `${event.kind}:${event.pubkey}:${event.tags.find((tag) => tag[0] === 'd')?.[1] ?? ''}`;
  return event.id;
}

/** The events a REQ's filters ask for, newest first, each filter's `limit` applied. */
function answer(stored: readonly NostrEvent[], filters: readonly Filter[]): NostrEvent[] {
  const found = new Map<string, NostrEvent>();
  for (const filter of filters) {
    const matching = stored.filter((event) => matchFilters([filter], event));
    for (const event of filter.limit === undefined ? matching : matching.slice(0, filter.limit)) found.set(event.id, event);
  }
  return [...found.values()].sort((a, b) => b.created_at - a.created_at);
}

/**
 * Relays that live in the page, for kernl's preview: applesauce's real `RelayPool` dials them
 * through a WebSocket that never leaves memory, and they answer as NIP-01 relays do. Every URL
 * answers from one store, so a publish to four relays is saved once and acknowledged four times.
 *
 * @param options - Relays that refuse every event.
 * @returns The socket constructor, and the store to seed and read.
 * @example
 * ```ts
 * const relays = createMemoryRelays();
 * relays.seed(profileEvent);
 * const pool = new RelayPool({ WebSocket: relays.WebSocket });
 * ```
 */
export function createMemoryRelays(options: MemoryRelaysOptions = {}): MemoryRelays {
  const slots = new Map<string, NostrEvent>();
  const sockets = new Set<MemorySocket>();
  // applesauce dials every relay at its normalised URL, with a trailing slash on a bare host.
  const refusing = new Set((options.refusing ?? []).map((url) => new URL(url).href));
  const store = (event: NostrEvent): void => {
    if (isEphemeral(event.kind)) return;
    const slot = slotOf(event);
    const held = slots.get(slot);
    if (!held || held.created_at < event.created_at) slots.set(slot, event);
  };
  const stored = (): NostrEvent[] => [...slots.values()].sort((a, b) => b.created_at - a.created_at);

  class MemorySocket {
    readyState = 0;
    binaryType = 'blob';
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: { wasClean: boolean; code: number; reason: string }) => void) | null = null;
    private readonly subscriptions = new Map<string, readonly Filter[]>();

    constructor(readonly url: string) {
      sockets.add(this);
      queueMicrotask(() => {
        this.readyState = OPEN;
        this.onopen?.({});
      });
    }

    send(data: string): void {
      const [type, ...rest] = JSON.parse(data) as [string, ...unknown[]];
      if (type === 'EVENT') this.received(rest[0] as NostrEvent);
      else if (type === 'REQ') this.request(rest[0] as string, rest.slice(1) as Filter[]);
      else if (type === 'CLOSE') this.subscriptions.delete(rest[0] as string);
    }

    close(code = 1000, reason = ''): void {
      if (this.readyState === CLOSED) return;
      this.readyState = CLOSED;
      sockets.delete(this);
      queueMicrotask(() => this.onclose?.({ wasClean: true, code, reason }));
    }

    deliver(event: NostrEvent): void {
      for (const [id, filters] of this.subscriptions) if (matchFilters([...filters], event)) this.reply(['EVENT', id, event]);
    }

    private received(event: NostrEvent): void {
      if (refusing.has(this.url)) return this.reply(['OK', event.id, false, 'blocked: this relay refuses everything']);
      store(event);
      this.reply(['OK', event.id, true, '']);
      for (const socket of sockets) socket.deliver(event);
    }

    private request(id: string, filters: readonly Filter[]): void {
      this.subscriptions.set(id, filters);
      for (const event of answer(stored(), filters)) this.reply(['EVENT', id, event]);
      this.reply(['EOSE', id]);
    }

    private reply(message: readonly unknown[]): void {
      queueMicrotask(() => {
        if (this.readyState === OPEN) this.onmessage?.({ data: JSON.stringify(message) });
      });
    }
  }

  // The socket has exactly what rxjs's WebSocketSubject uses (readyState, the four handlers, send, close),
  // not the rest of the DOM's WebSocket, so it widens through unknown once, here.
  const constructor: unknown = MemorySocket;
  return {
    WebSocket: constructor as RelaySocketConstructor,
    seed: (...events) => events.forEach(store),
    events: stored,
  };
}
