/* global $derived */
import { createAskQueue, type AskQueue } from '@kernlize/ui-model';
import type { ReplyAnswer } from '@kernlize/messaging';
import { observe } from './observe.svelte';

/** The reply question's binding to its ask queue: one at a time, in arrival order (#74). */
export class ReplyQueue {
  readonly model: AskQueue<'messaging.choose-reply'> = createAskQueue();
  readonly #waiting = observe(this.model.waiting$, []);
  readonly current = $derived(this.#waiting.value[0]?.facts);

  answer(answer: ReplyAnswer | undefined): void {
    this.model.answer(answer);
  }
}
