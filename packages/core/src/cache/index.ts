/**
 * The event cache, on its own: `@kernlize/core/cache` loads none of the network stack, and sqlite-wasm is
 * loaded only inside the worker the sqlite adapter starts. Everything here is also exported from
 * `@kernlize/core`.
 */
export type {
  AttachedEventCache,
  AttachEventCacheOptions,
  CacheRecoveryEvent,
  EventCache,
  EventCacheAdapter,
  FilenameStorage,
  IndexedDbCacheOptions,
  LockManagerLike,
  OpenEventCacheOptions,
  SqliteDriver,
  SqliteFiles,
  SqliteOpfsOptions,
  SqlStatement,
  SqlValue,
} from './types.js';
export { createEventCache, type EventRecords } from './event-cache.js';
export { fromEventDatabase } from './event-database.js';
export { createMemoryCacheAdapter, defaultWebCacheAdapters, openEventCache } from './open.js';
export { createIndexedDbCacheAdapter } from './indexeddb.js';
export { createSqliteOpfsCacheAdapter } from './sqlite-opfs.js';
export { isCorruptionError } from './sqlite-records.js';
export { attachEventCache } from './attach.js';
