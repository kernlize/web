import type { Filter, NostrEvent } from 'applesauce-core/helpers';

/** What the kernel asks of a cache module before any relay: the events it holds for some filters (D-030). */
export interface CacheLookup {
  readonly cacheOutboxReads?: boolean;
  cacheRequest(filters: Filter[]): Promise<NostrEvent[]>;
}
