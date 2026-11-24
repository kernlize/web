/* global $derived */
import { createAskQueue, type AskQueue } from '@kernlize/ui-model';
import type { ConsentSummary } from './contract';
import { observe } from './observe.svelte';

/** The four kinds the consent dialog draws. */
export type ConsentKind = 'sign.replace' | 'upload.file' | 'download.add' | 'connection.direct';

/** The consent dialog's binding to its ask queue: one question at a time across the four kinds, in arrival order (#74). */
export class ConsentQueue {
  readonly model: AskQueue<ConsentKind> = createAskQueue();
  readonly #waiting = observe(this.model.waiting$, []);
  readonly current = $derived(this.#waiting.value[0] && { summary: this.#waiting.value[0].defaultText as ConsentSummary });

  answer(allowed: boolean): void {
    this.model.answer(allowed);
  }
}
