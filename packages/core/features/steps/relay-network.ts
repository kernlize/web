import { Observable, of, type Subscriber } from 'rxjs';
import { matchFilters, normalizeRelayUrl, type Filter, type NostrEvent } from 'applesauce-core/helpers';
import type { PublishResponse } from 'applesauce-relay';
import type { ApplesaucePool } from '@kernlize/core';
import type { ReqMessage } from './world.js';

interface LiveReq {
  readonly relays: readonly string[];
  readonly filters: readonly Filter[];
  readonly observer: Subscriber<ReqMessage>;
}

/** A fake set of relays that stores what is published and streams it to open subscriptions that match. */
export interface RelayNetwork extends ApplesaucePool {
  readonly stored: Map<string, NostrEvent[]>;
  readonly published: { relays: string[]; event: NostrEvent }[];
  readonly live: Set<LiveReq>;
  /** Events every relay serves, such as an applet manifest. */
  readonly everywhere: NostrEvent[];
  refuseLookups: boolean;
  refusePublishes: boolean;
  /** Runs right after a publish reached the open subscriptions, before anything could open it. */
  afterPublish?: () => void;
  /** Deliver an event to every open subscription, as a relay that ignores filters would. */
  push(event: NostrEvent): void;
}

function storedOn(network: RelayNetwork, relays: readonly string[], filters: readonly Filter[]): NostrEvent[] {
  const found = new Map<string, NostrEvent>();
  for (const event of network.everywhere) if (matchFilters([...filters], event)) found.set(event.id, event);
  for (const relay of relays) for (const event of network.stored.get(relay) ?? []) if (matchFilters([...filters], event)) found.set(event.id, event);
  return [...found.values()];
}

export function createRelayNetwork(): RelayNetwork {
  const network: RelayNetwork = {
    stored: new Map(),
    published: [],
    live: new Set(),
    everywhere: [],
    refuseLookups: false,
    refusePublishes: false,
    req(relays, filters) {
      const urls = (relays as string[]).map(normalizeRelayUrl);
      const list = (Array.isArray(filters) ? filters : [filters]) as Filter[];
      return new Observable<ReqMessage>((observer) => {
        for (const event of storedOn(network, urls, list)) observer.next({ type: 'EVENT', from: urls[0] as string, id: 'sub', event });
        for (const url of urls) observer.next({ type: 'EOSE', from: url, id: 'sub' });
        const entry: LiveReq = { relays: urls, filters: list, observer };
        network.live.add(entry);
        return () => network.live.delete(entry);
      });
    },
    request(relays, filters) {
      if (network.refuseLookups) return new Observable<NostrEvent>((observer) => observer.error(new Error('down'))) as ReturnType<ApplesaucePool['request']>;
      const list = (Array.isArray(filters) ? filters : [filters]) as Filter[];
      return of(...storedOn(network, (relays as string[]).map(normalizeRelayUrl), list)) as ReturnType<ApplesaucePool['request']>;
    },
    async publish(relays, event) {
      const urls = (relays as string[]).map(normalizeRelayUrl);
      if (network.refusePublishes) throw new Error('refused');
      const plain = JSON.parse(JSON.stringify(event)) as NostrEvent;
      network.published.push({ relays: urls, event: plain });
      for (const url of urls) network.stored.set(url, [...(network.stored.get(url) ?? []), plain]);
      for (const entry of network.live) {
        if (entry.relays.some((url) => urls.includes(url)) && matchFilters([...entry.filters], plain)) entry.observer.next({ type: 'EVENT', from: urls[0] as string, id: 'sub', event: plain });
      }
      network.afterPublish?.();
      return urls.map((from): PublishResponse => ({ ok: true, from }));
    },
    push(event) {
      const plain = JSON.parse(JSON.stringify(event)) as NostrEvent;
      for (const entry of network.live) entry.observer.next({ type: 'EVENT', from: entry.relays[0] as string, id: 'sub', event: plain });
    },
  };
  return network;
}

