/* global $state, $derived */
import type { HandlerChoice, HandlerPrompt } from './contract';

interface Pending {
  readonly prompt: HandlerPrompt;
  readonly resolve: (choice: HandlerChoice | undefined) => void;
}

/** Which applet should take a request: one chooser at a time, the rest wait in arrival order. */
export class HandlerQueue {
  queue = $state.raw<readonly Pending[]>([]);
  readonly current = $derived(this.queue[0]?.prompt);

  ask(prompt: HandlerPrompt): Promise<HandlerChoice | undefined> {
    return new Promise((resolve) => {
      this.queue = [...this.queue, { prompt, resolve }];
    });
  }

  answer(choice: HandlerChoice | undefined): void {
    const [head, ...rest] = this.queue;
    if (!head) return;
    this.queue = rest;
    head.resolve(choice);
  }
}
