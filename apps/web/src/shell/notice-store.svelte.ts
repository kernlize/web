import { createNoticeStore, type Notice } from '@kernlize/ui-model';
import { observe } from './observe.svelte';

export type { Notice };

/** The toasts' binding to the notice store model (#74). */
export class NoticeStore {
  readonly model = createNoticeStore();
  readonly #items = observe(this.model.items$, []);

  get items(): readonly Notice[] {
    return this.#items.value;
  }

  push(notice: Omit<Notice, 'id'>): Notice {
    return this.model.push(notice);
  }

  dismiss(id: number): void {
    this.model.dismiss(id);
  }
}
