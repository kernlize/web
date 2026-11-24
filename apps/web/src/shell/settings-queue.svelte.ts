/* global $derived */
import { createAskQueue, type AskQueue } from '@kernlize/ui-model';
import { observe } from './observe.svelte';

/** The settings form's binding to its ask queue: one applet's form at a time, in arrival order (#74). */
export class SettingsQueue {
  readonly model: AskQueue<'settings.present'> = createAskQueue();
  readonly #waiting = observe(this.model.waiting$, []);
  readonly current = $derived(this.#waiting.value[0]?.facts);

  close(): void {
    this.model.answer(undefined);
  }
}
