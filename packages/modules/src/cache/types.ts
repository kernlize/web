import type { Filter, NostrEvent } from 'applesauce-core/helpers';

/**
 * A place events are kept between visits. Every backend keeps the same rules: for a replaceable or addressable
 * event only the newest version is kept, a deletion by the same author removes its targets and keeps them out,
 * and ephemeral events are never stored (D-030).
 */
export interface EventCache {
  /** Which backend this is: `sqlite-opfs`, `indexeddb`, `memory`, or a custom name. */
  readonly name: string;
  /** Store events. Duplicates, older replaceable versions and deleted events are dropped. */
  add(events: readonly NostrEvent[]): Promise<void>;
  /** Events matching any of the filters, newest first, each filter's `limit` applied to that filter. */
  query(filters: readonly Filter[]): Promise<NostrEvent[]>;
  /** Remove the events matching any of the filters; resolves how many were removed. */
  removeByFilters(filters: readonly Filter[]): Promise<number>;
  /** Remove every event. */
  clear(): Promise<void>;
  /** Release the backend. The cache is not used after this. */
  close(): Promise<void>;
}

/** Opens one kind of {@link EventCache}. */
export interface EventCacheAdapter {
  /** The name the opened cache will carry. */
  readonly name: string;
  /** Open the cache; rejects with `unavailable:<reason>` when this context cannot support it. */
  open(): Promise<EventCache>;
}

/** Options for {@link openEventCache}. */
export interface OpenEventCacheOptions {
  /** Called for every adapter that did not open, with its name and the reason it gave. */
  onFallback?(name: string, reason: string): void;
}

/** Options for the IndexedDB adapter. */
export interface IndexedDbCacheOptions {
  /** The database name. Default `kernl-events`. */
  readonly name?: string;
  /** The factory to open it with. Default `globalThis.indexedDB`. */
  readonly indexedDB?: IDBFactory;
}

/** Options for {@link attachEventCache}, passed to applesauce's `persistEventsToCache`. */
export interface AttachEventCacheOptions {
  /** Milliseconds to collect new events before writing them. Default 5000. */
  readonly batchTime?: number;
  /** Write early once this many events are waiting. */
  readonly maxBatchSize?: number;
}

/** A cache wired to an event store: new events are written to it, and loaders read from it. */
export interface AttachedEventCache {
  /** A loader `cacheRequest`: matching events marked as from the cache, or none when the cache cannot answer. */
  readonly cacheRequest: (filters: Filter[]) => Promise<NostrEvent[]>;
  /** Stop writing new events to the cache. */
  stop(): void;
}

/** What the sqlite cache did about a damaged database. */
export interface CacheRecoveryEvent {
  /** `wiped`: the file was removed and opened fresh. `rotated`: a new file was used. `disabled`: the cache gave up. */
  readonly action: 'wiped' | 'rotated' | 'disabled';
  /** The error that showed the damage. */
  readonly reason: string;
}

/** A value bound to a SQL parameter. */
export type SqlValue = string | number | null;

/** One SQL statement and its parameters. */
export interface SqlStatement {
  readonly sql: string;
  readonly params?: readonly SqlValue[];
}

/** One open sqlite database, as the sqlite cache needs it. */
export interface SqliteDriver {
  /** Run the statements in one transaction. */
  exec(statements: readonly SqlStatement[]): Promise<void>;
  /** Run one statement and resolve its rows as objects. */
  query(statement: SqlStatement): Promise<Record<string, unknown>[]>;
  /** Close the database. */
  close(): Promise<void>;
}

/** Where the sqlite cache's database files live: the SAH pool in a worker, or a fake in tests. */
export interface SqliteFiles {
  /** Open, creating when absent, the database at `filename`. */
  open(filename: string): Promise<SqliteDriver>;
  /** Remove the database at `filename` and its journal. Rejects when it cannot. */
  wipe(filename: string): Promise<void>;
  /** Release every file and whatever runs them. */
  close(): Promise<void>;
}

/** The part of the Web Locks API the sqlite cache uses. */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => Promise<void> | void): Promise<unknown>;
}

/** The part of `Storage` the sqlite cache keeps its current filename in. */
export interface FilenameStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Options for the sqlite-over-OPFS adapter. */
export interface SqliteOpfsOptions {
  /** The database file in the SAH pool. Default `/kernl-events.sqlite3`. */
  readonly filename?: string;
  /** Keeps the filename after a rotation. Default `globalThis.localStorage` when there is one. */
  readonly storage?: FilenameStorage;
  /** Guards the database against a second tab. Default `navigator.locks` when there is one. */
  readonly locks?: LockManagerLike;
  /** Opens the database files. Default: a dedicated worker running sqlite-wasm over the OPFS SAH pool. */
  readonly connect?: () => Promise<SqliteFiles>;
  /** Told whenever a damaged database was wiped or rotated, or the cache gave up. */
  onRecover?(event: CacheRecoveryEvent): void;
}
