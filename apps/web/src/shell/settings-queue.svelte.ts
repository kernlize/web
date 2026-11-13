/* global $state, $derived */
import type { SettingsPrompt } from './contract';

/** One applet's settings form at a time; the rest wait in arrival order. */
export class SettingsQueue {
  queue = $state.raw<readonly SettingsPrompt[]>([]);
  readonly current = $derived(this.queue[0]);

  show(prompt: SettingsPrompt): void {
    this.queue = [...this.queue, prompt];
  }

  close(): void {
    this.queue = this.queue.slice(1);
  }
}
