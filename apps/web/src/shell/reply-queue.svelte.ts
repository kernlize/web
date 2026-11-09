/* global $state, $derived */
import type { ReplyAnswer, ReplyPrompt } from '@kernlize/messaging';

interface Pending {
  readonly prompt: ReplyPrompt;
  readonly resolve: (answer: ReplyAnswer | undefined) => void;
}

/** Which provider a reply should leave through: one question at a time, the rest wait in arrival order. */
export class ReplyQueue {
  queue = $state.raw<readonly Pending[]>([]);
  readonly current = $derived(this.queue[0]?.prompt);

  ask(prompt: ReplyPrompt): Promise<ReplyAnswer | undefined> {
    return new Promise((resolve) => {
      this.queue = [...this.queue, { prompt, resolve }];
    });
  }

  answer(answer: ReplyAnswer | undefined): void {
    const [head, ...rest] = this.queue;
    if (!head) return;
    this.queue = rest;
    head.resolve(answer);
  }
}
