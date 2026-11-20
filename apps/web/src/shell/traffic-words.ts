import type { GuardEvent } from '@kernlize/guard';
import type { AppletMessage } from './contract';

/** What stands out about an entry: a failure it reports, or something the guard did to it. */
export type TrafficMark = 'error' | 'warning';

/** One row in an applet's message log. */
export interface TrafficEntry {
  /** Unique across the page, for keyed lists. */
  readonly id: number;
  readonly windowId: string;
  readonly at: number;
  readonly direction: AppletMessage['direction'] | 'guard';
  readonly via?: AppletMessage['via'];
  /** The envelope's type, or the guard's reason code, such as `flood:burst`. */
  readonly type: string;
  readonly mark?: TrafficMark;
  /** One line about the mark: what failed, or what the guard did. */
  readonly note?: string;
  /** The envelope itself; kept in memory only. */
  readonly payload?: unknown;
}

/** Errors and warnings an applet has had. */
export interface TrafficMarks {
  readonly errors: number;
  readonly warnings: number;
}

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
  return { id, windowId, at, direction, via, type, payload: message.message, ...(error ? { mark: 'error', note: error } : {}) };
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
