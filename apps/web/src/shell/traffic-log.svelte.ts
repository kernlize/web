import { untrack } from 'svelte';
import type { GuardEvent } from '@kernlize/guard';
import type { AppletMessage } from './contract';
import { guardEventWords } from './guard-log.svelte';
import { entryOfGuardEvent, entryOfMessage, type TrafficEntry, type TrafficMarks } from './traffic-words';
import { createTrafficLog } from '@kernlize/ui-model';
import { map } from 'rxjs';
import { observe } from './observe.svelte';

/** Rows kept per window. Older ones go; the counts stay. */
const KEEP = 200;

/**
 * What each applet sent and received this page, newest first, with the guard's say on it. Payloads
 * can hold private messages and signed events, so nothing here is ever written to storage.
 */
export class TrafficLog {
  readonly model = createTrafficLog<TrafficEntry>(KEEP);
  // Bumped on every change, so a reader of a window's rows hears when they change.
  readonly #version = observe(this.model.changes$.pipe(map((_, index) => index)), 0);
  #next = 0;

  message(message: AppletMessage): void {
    this.model.add(entryOfMessage(message, (this.#next += 1)));
  }

  guard(event: GuardEvent): void {
    const entry = entryOfGuardEvent(event, (this.#next += 1), guardEventWords(event));
    if (entry) this.model.add(entry);
  }

  forWindow(windowId: string): readonly TrafficEntry[] {
    void this.#version.value;
    return this.model.forWindow(windowId);
  }

  marks(windowId: string): TrafficMarks {
    void this.#version.value;
    return this.model.marks(windowId);
  }

  /** Forget every window not in `ids`: a closed window's log goes with it. */
  retain(ids: ReadonlySet<string>): void {
    // Without tracking: the effect that calls this follows the windows, not every message.
    untrack(() => this.model.retain(ids));
  }
}
