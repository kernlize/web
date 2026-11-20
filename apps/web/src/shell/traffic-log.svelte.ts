/* global $state */
import type { GuardEvent } from '@kernlize/guard';
import type { AppletMessage } from './contract';
import { guardEventWords } from './guard-log.svelte';
import { countMark, entryOfGuardEvent, entryOfMessage, type TrafficEntry, type TrafficMarks } from './traffic-words';

/** Rows kept per window. Older ones go; the counts stay. */
const KEEP = 200;
const NONE: TrafficMarks = { errors: 0, warnings: 0 };

/**
 * What each applet sent and received this page, newest first, with the guard's say on it. Payloads
 * can hold private messages and signed events, so nothing here is ever written to storage.
 */
export class TrafficLog {
  #rows = $state.raw<ReadonlyMap<string, readonly TrafficEntry[]>>(new Map());
  #marks = $state.raw<ReadonlyMap<string, TrafficMarks>>(new Map());
  #next = 0;

  message(message: AppletMessage): void {
    this.#add(entryOfMessage(message, (this.#next += 1)));
  }

  guard(event: GuardEvent): void {
    const entry = entryOfGuardEvent(event, (this.#next += 1), guardEventWords(event));
    if (entry) this.#add(entry);
  }

  forWindow(windowId: string): readonly TrafficEntry[] {
    return this.#rows.get(windowId) ?? [];
  }

  marks(windowId: string): TrafficMarks {
    return this.#marks.get(windowId) ?? NONE;
  }

  /** Forget every window not in `ids`: a closed window's log goes with it. */
  retain(ids: ReadonlySet<string>): void {
    if ([...this.#rows.keys(), ...this.#marks.keys()].every((id) => ids.has(id))) return;
    this.#rows = new Map([...this.#rows].filter(([id]) => ids.has(id)));
    this.#marks = new Map([...this.#marks].filter(([id]) => ids.has(id)));
  }

  #add(entry: TrafficEntry): void {
    const rows = new Map(this.#rows);
    rows.set(entry.windowId, [entry, ...(rows.get(entry.windowId) ?? [])].slice(0, KEEP));
    this.#rows = rows;
    if (!entry.mark) return;
    const marks = new Map(this.#marks);
    marks.set(entry.windowId, countMark(this.marks(entry.windowId), entry));
    this.#marks = marks;
  }
}
