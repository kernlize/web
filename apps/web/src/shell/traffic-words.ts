import type { TrafficMarks } from '@kernlize/ui-model';
import type { GuardEvent } from '@kernlize/guard';
import type { AppletMessage } from './contract';

/** What stands out about an entry: a failure it reports, or something the guard did to it. */
export type TrafficMark = 'error' | 'warning';

/** One row in an applet's message log. */
export interface TrafficEntry {
  /** Unique across the page, for keyed lists. */
  readonly id: number;
  readonly windowId: string;
  /** When the newest of the messages this row stands for arrived. */
  readonly at: number;
  readonly direction: AppletMessage['direction'] | 'guard';
  readonly via?: AppletMessage['via'];
  /** The envelope's type, or the guard's reason code, such as `flood:burst`. */
  readonly type: string;
  readonly mark?: TrafficMark;
  /** One line about the mark: what failed, or what the guard did. */
  readonly note?: string;
  /** Set when the same message repeated: how many of them this row stands for, and when the first came. */
  readonly repeat?: TrafficRepeat;
  /** The envelope itself; kept in memory only. */
  readonly payload?: unknown;
}

/** A run of one message, folded into the row it repeats. */
export interface TrafficRepeat {
  /** Two or more: one message is not a repeat. */
  readonly repeats: number;
  /** When the first of the run arrived; `at` is when the newest did. */
  readonly since: number;
}

/** Errors and warnings an applet has had. */
export type { TrafficMarks } from '@kernlize/ui-model';

/**
 * A row for a message: marked as an error when it reports a failure.
 *
 * @param message - What the shell reported.
 * @param id - The row's id.
 * @returns The row.
 * @example
 * ```ts
 * entryOfMessage({ windowId: 'w1', direction: 'to-applet', via: 'port', type: 'x.result', error: 'denied', message: {}, at: 0 }, 1).mark; // 'error'
 * ```
 */
export function entryOfMessage(message: AppletMessage, id: number): TrafficEntry {
  const { windowId, at, direction, via, type, error } = message;
  return { id, windowId, at, direction, via, type, payload: trimPayload(message.message), ...(error ? { mark: 'error', note: error } : {}) };
}

/** Longest string kept whole; a fetched file arrives as one base64 string of all its bytes. */
export const PAYLOAD_TEXT_LIMIT = 512;
const PAYLOAD_DEPTH_LIMIT = 6;

const binaryLength = (value: object): number | undefined =>
  value instanceof ArrayBuffer ? value.byteLength : ArrayBuffer.isView(value) ? value.byteLength : typeof Blob !== 'undefined' && value instanceof Blob ? value.size : undefined;

/** Items kept from one array, or keys from one object. */
const PAYLOAD_ENTRY_LIMIT = 50;
/** Values kept from one payload in all, however it is shaped. */
const PAYLOAD_NODE_LIMIT = 2000;

/**
 * A copy of a payload small enough to keep and to show. A long string keeps its start and says how
 * long it was, bytes say how many there were, an array or object keeps its first 50 entries and
 * says how many it had, nesting stops at six levels or where it leads back into itself, and no
 * payload keeps more than 2000 values. An applet chooses what it sends, and the log keeps 200 rows
 * per window, so none of it may grow with the applet.
 *
 * @param payload - What the applet sent or got.
 * @returns The copy the log keeps.
 * @example
 * ```ts
 * trimPayload({ blob: 'QUJD'.repeat(1000) }); // { blob: 'QUJDQUJD… (4000 characters)' }
 * ```
 */
export function trimPayload(payload: unknown): unknown {
  let budget = PAYLOAD_NODE_LIMIT;
  const ancestors = new Set<object>();
  const trim = (value: unknown, depth: number): unknown => {
    budget -= 1;
    if (typeof value === 'string') return value.length > PAYLOAD_TEXT_LIMIT ? `${value.slice(0, 64)}… (${value.length} characters)` : value;
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value !== 'object' || value === null) return value;
    const bytes = binaryLength(value);
    if (bytes !== undefined) return `<${value.constructor.name} ${bytes} bytes>`;
    if (ancestors.has(value)) return '<circular>';
    if (depth >= PAYLOAD_DEPTH_LIMIT || budget <= 0) return Array.isArray(value) ? '<array>' : '<object>';
    ancestors.add(value);
    const copy = Array.isArray(value) ? trimArray(value, depth) : trimObject(value, depth);
    ancestors.delete(value);
    return copy;
  };
  const trimArray = (value: readonly unknown[], depth: number): unknown[] => {
    const kept = value.slice(0, PAYLOAD_ENTRY_LIMIT).map((item) => trim(item, depth + 1));
    return value.length > PAYLOAD_ENTRY_LIMIT ? [...kept, `<${value.length - PAYLOAD_ENTRY_LIMIT} more>`] : kept;
  };
  const trimObject = (value: object, depth: number): Record<string, unknown> => {
    const copy: Record<string, unknown> = {};
    let count = 0;
    // for…in stops early, where Object.entries would list a million keys first.
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      count += 1;
      if (count > PAYLOAD_ENTRY_LIMIT) {
        copy['…'] = 'more keys';
        break;
      }
      copy[key] = trim((value as Record<string, unknown>)[key], depth + 1);
    }
    return copy;
  };
  return trim(payload, 0);
}

/**
 * Fold a repeat into the row it repeats: same direction, type, channel, mark and note, so a burst of
 * one message becomes one row with a count instead of taking the room a failure needs. The row keeps
 * its id, takes the newest time and payload, and remembers when the first of them arrived.
 *
 * @param kept - The newest row so far.
 * @param arriving - The row that just came in.
 * @returns The row to keep in its place, or `undefined` when this is something else.
 * @example
 * ```ts
 * foldRepeat({ id: 1, windowId: 'w1', at: 0, direction: 'to-applet', type: 'gamepad.state' }, { id: 2, windowId: 'w1', at: 9, direction: 'to-applet', type: 'gamepad.state' })?.repeat?.repeats; // 2
 * ```
 */
export function foldRepeat(kept: TrafficEntry, arriving: TrafficEntry): TrafficEntry | undefined {
  const same = kept.direction === arriving.direction && kept.type === arriving.type && kept.via === arriving.via && kept.mark === arriving.mark && kept.note === arriving.note;
  if (!same) return undefined;
  return { ...arriving, id: kept.id, repeat: { repeats: (kept.repeat?.repeats ?? 1) + 1, since: kept.repeat?.since ?? kept.at } };
}

/**
 * "43 times, first at 8:25:39 PM": what a folded row hides.
 *
 * @param repeat - The run the row stands for.
 * @param timeOf - How the shell writes a time.
 * @returns The words for the row's count.
 * @example
 * ```ts
 * repeatWords({ repeats: 3, since: 0 }, (at) => new Date(at).toISOString()); // '3 times, first at 1970-01-01T00:00:00.000Z'
 * ```
 */
export function repeatWords(repeat: TrafficRepeat, timeOf: (at: number) => string): string {
  return `${repeat.repeats} times, first at ${timeOf(repeat.since)}`;
}

/**
 * A row for something the guard did, or nothing when it let the message through. Requests held
 * while the window is hidden are normal and carry no mark.
 *
 * @param event - The guard's event.
 * @param id - The row's id.
 * @param words - The guard log's own words for the event.
 * @returns The row, or `undefined` for a pass.
 * @example
 * ```ts
 * entryOfGuardEvent({ disposition: 'reject', windowId: 'w1', napplet: 'n', opClass: 'storage:write', reason: 'rate:storage:write', at: 0 }, 2, 'went over a limit').mark; // 'warning'
 * ```
 */
export function entryOfGuardEvent(event: GuardEvent, id: number, words: string): TrafficEntry | undefined {
  if (event.disposition === 'pass') return undefined;
  const held = event.reason.startsWith('hidden:');
  return { id, windowId: event.windowId, at: event.at, direction: 'guard', type: event.reason, note: words, ...(held ? {} : { mark: 'warning' }) };
}

/**
 * Add a row's mark to the running counts.
 *
 * @param marks - The counts so far.
 * @param entry - The new row.
 * @returns The counts with this row in them.
 * @example
 * ```ts
 * countMark({ errors: 0, warnings: 1 }, { mark: 'error' } as TrafficEntry); // { errors: 1, warnings: 1 }
 * ```
 */
export function countMark(marks: TrafficMarks, entry: TrafficEntry): TrafficMarks {
  if (entry.mark === 'error') return { ...marks, errors: marks.errors + 1 };
  if (entry.mark === 'warning') return { ...marks, warnings: marks.warnings + 1 };
  return marks;
}

/** "2 errors · 1 warning", or an empty string when there are none. */
export function describeMarks(marks: TrafficMarks): string {
  const parts = [
    marks.errors > 0 ? `${marks.errors} ${marks.errors === 1 ? 'error' : 'errors'}` : '',
    marks.warnings > 0 ? `${marks.warnings} ${marks.warnings === 1 ? 'warning' : 'warnings'}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

const DIRECTIONS: Readonly<Record<TrafficEntry['direction'], string>> = {
  'from-applet': 'applet → shell',
  'to-applet': 'shell → applet',
  guard: 'guard',
};

/** "applet → shell", "shell → applet" or "guard". */
export const directionLabel = (entry: TrafficEntry): string => DIRECTIONS[entry.direction];

/**
 * The payload as indented JSON, or as text when it cannot be serialised.
 *
 * @param payload - The envelope.
 * @returns What the log shows when the row is opened.
 * @example
 * ```ts
 * formatPayload({ type: 'shell.ready' }); // '{\n  "type": "shell.ready"\n}'
 * ```
 */
export function formatPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2) ?? String(payload);
  } catch {
    return String(payload);
  }
}
