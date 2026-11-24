/* global $derived */
import { createAskQueue, type AskQueue } from '@kernlize/ui-model';
import type { FirewallChoice } from './contract';
import { observe } from './observe.svelte';

/** The firewall dialog's binding to its ask queue: one question at a time; a question the shell withdraws leaves it (#74). */
export class FirewallQueue {
  readonly model: AskQueue<'firewall.approve'> = createAskQueue();
  readonly #waiting = observe(this.model.waiting$, []);
  readonly queue = $derived(this.#waiting.value);
  readonly current = $derived(this.#waiting.value[0] && { summary: this.#waiting.value[0].facts });

  /** Answer the question on screen; `undefined` dismisses it without storing anything. */
  answer(choice: FirewallChoice | undefined): void {
    this.model.answer(choice);
  }
}
