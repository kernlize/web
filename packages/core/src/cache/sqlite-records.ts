import { getIndexableTags, getReplaceableIdentifier, type NostrEvent } from 'applesauce-core/helpers';
import {
  buildFiltersQuery,
  CREATE_EVENT_TAGS_TABLE_STATEMENT,
  CREATE_EVENTS_TABLE_STATEMENT,
  CREATE_INDEXES_STATEMENTS,
  DELETE_EVENT_STATEMENT,
  DELETE_EVENT_TAGS_STATEMENT,
  INSERT_EVENT_STATEMENT_WITH_IGNORE,
  INSERT_EVENT_TAG_STATEMENT_WITH_IGNORE,
  rowToEvent,
  type EventRow,
} from 'applesauce-sqlite/helpers';
import type { EventRecords } from './event-cache.js';
import type { SqliteDriver, SqlStatement } from './types.js';

/** applesauce-sqlite's schema, so a database written here can be read by its better-sqlite3 or libsql databases. */
export const SCHEMA: readonly SqlStatement[] = [CREATE_EVENTS_TABLE_STATEMENT, CREATE_EVENT_TAGS_TABLE_STATEMENT, ...CREATE_INDEXES_STATEMENTS];

/** Damage sqlite reports as an error code or message. Anything else is an ordinary failure. */
const CORRUPTION = /SQLITE_CORRUPT|SQLITE_NOTADB|database disk image is malformed|file is not a database/i;

/**
 * Whether an error means the database file is damaged, rather than busy, full or misused.
 *
 * @param error - Whatever a sqlite call threw.
 * @returns True for `SQLITE_CORRUPT`, `SQLITE_NOTADB` and their messages.
 * @example
 * ```ts
 * import { isCorruptionError } from '@kernlize/core/cache';
 *
 * isCorruptionError(new Error('SQLITE_CORRUPT: database disk image is malformed')); // true
 * isCorruptionError(new Error('SQLITE_BUSY: database is locked')); // false
 * ```
 */
export function isCorruptionError(error: unknown): boolean {
  return CORRUPTION.test(error instanceof Error ? error.message : String(error));
}

/** Reject unless `PRAGMA quick_check` says the file is whole, then make sure the schema is there. */
export async function checkAndMigrate(driver: SqliteDriver): Promise<void> {
  const rows = await driver.query({ sql: 'PRAGMA quick_check' });
  const verdict = rows.map((row) => String(row.quick_check)).join('; ');
  if (verdict !== 'ok') throw new Error(`SQLITE_CORRUPT: quick_check: ${verdict}`);
  await driver.exec(SCHEMA);
}

function insertStatements(event: NostrEvent): SqlStatement[] {
  const row = [event.id, event.kind, event.pubkey, event.created_at, event.content, JSON.stringify(event.tags), event.sig, getReplaceableIdentifier(event)];
  const tags = [...getIndexableTags(event)].map((key) => {
    const separator = key.indexOf(':');
    return { sql: INSERT_EVENT_TAG_STATEMENT_WITH_IGNORE.sql, params: [event.id, key.slice(0, separator), key.slice(separator + 1)] };
  });
  return [{ sql: INSERT_EVENT_STATEMENT_WITH_IGNORE.sql, params: row }, ...tags];
}

/**
 * The cache's rows in sqlite, through whatever `run` hands out: the driver, possibly behind a recovery guard.
 *
 * @param run - Runs one operation against the current driver.
 * @param close - Releases the database.
 * @returns Records for {@link createEventCache}.
 */
export function sqliteRecords(run: <T>(operation: (driver: SqliteDriver) => Promise<T>) => Promise<T>, close: () => Promise<void>): EventRecords {
  return {
    put: (events) => run((driver) => driver.exec(events.flatMap(insertStatements))),
    query: (filter) =>
      run(async (driver) => {
        // One filter always yields a query; buildFiltersQuery returns null only for an empty list.
        return (await driver.query(buildFiltersQuery([filter]) as SqlStatement)).map((row) => rowToEvent(row as unknown as EventRow));
      }),
    remove: (ids) => run((driver) => driver.exec(ids.flatMap((id) => [{ sql: DELETE_EVENT_TAGS_STATEMENT.sql, params: [id] }, { sql: DELETE_EVENT_STATEMENT.sql, params: [id] }]))),
    clear: () => run((driver) => driver.exec([{ sql: 'DELETE FROM event_tags' }, { sql: 'DELETE FROM events' }])),
    close,
  };
}
