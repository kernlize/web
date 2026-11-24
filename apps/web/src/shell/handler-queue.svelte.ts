/* global $derived */
import { createAskQueue, type AskQueue } from '@kernlize/ui-model';
import type { HandlerChoice } from './contract';
import { observe } from './observe.svelte';

/** The handler chooser's binding to its ask queue: one chooser at a time, in arrival order (#74). */
export class HandlerQueue {
  readonly model: AskQueue<'intent.choose-handler'> = createAskQueue();
  readonly #waiting = observe(this.model.waiting$, []);
  readonly current = $derived(this.#waiting.value[0]?.facts);

  answer(choice: HandlerChoice | undefined): void {
    this.model.answer(choice);
  }
}
