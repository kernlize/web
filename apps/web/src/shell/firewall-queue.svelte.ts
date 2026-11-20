/* global $state, $derived, $effect */
import type { FirewallChoice, FirewallPrompt } from './contract';

/** One firewall question at a time; the rest wait in arrival order. A question the shell withdraws leaves the queue. */
export class FirewallQueue {
  queue = $state.raw<readonly FirewallPrompt[]>([]);
  readonly current = $derived(this.queue[0]);

  enqueue(prompt: FirewallPrompt): void {
    if (prompt.signal.aborted) return;
    this.queue = [...this.queue, prompt];
    prompt.signal.addEventListener('abort', () => {
      this.queue = this.queue.filter((waiting) => waiting !== prompt);
    }, { once: true });
  }

  /** Answer the question on screen; `undefined` dismisses it without storing anything. */
  answer(choice: FirewallChoice | undefined): void {
    const [head, ...rest] = this.queue;
    if (!head) return;
    this.queue = rest;
    head.resolve(choice);
  }
}
