/* global $state, $derived, $effect */
import type { ConsentPrompt } from './contract';

/** One dialog at a time; the rest wait in arrival order. */
export class ConsentQueue {
  queue = $state.raw<readonly ConsentPrompt[]>([]);
  readonly current = $derived(this.queue[0]);

  enqueue(prompt: ConsentPrompt): void {
    this.queue = [...this.queue, prompt];
  }

  answer(allowed: boolean): void {
    const [head, ...rest] = this.queue;
    if (!head) return;
    this.queue = rest;
    head.resolve(allowed);
  }
}
