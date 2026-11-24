import { createUnreadCount } from '@kernlize/ui-model';
import type { MessagingBackend } from '@kernlize/messaging';
import { observe } from './observe.svelte';

/** The Messages badge's binding to the unread count model (#74): what arrived while the person was elsewhere. */
export class UnreadMessages {
  readonly model = createUnreadCount();
  readonly #count = observe(this.model.count$, 0);

  get count(): number {
    return this.#count.value;
  }

  watch(backend: MessagingBackend, reading: () => boolean): () => void {
    return this.model.watch(backend, reading);
  }

  clear(): void {
    this.model.clear();
  }
}
