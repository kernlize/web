/* global $state, $derived, $effect */
export interface Notice {
  readonly id: number;
  readonly title: string;
  readonly body?: string;
  readonly tone: 'info' | 'warning';
  readonly windowId?: string;
}

const LIFETIME_MS: Readonly<Record<Notice['tone'], number>> = { info: 6000, warning: 12_000 };

export class NoticeStore {
  items = $state.raw<readonly Notice[]>([]);
  #next = 1;

  push(notice: Omit<Notice, 'id'>): Notice {
    const entry: Notice = { ...notice, id: this.#next++ };
    this.items = [...this.items, entry];
    setTimeout(() => this.dismiss(entry.id), LIFETIME_MS[notice.tone]);
    return entry;
  }

  dismiss(id: number): void {
    this.items = this.items.filter((item) => item.id !== id);
  }
}
