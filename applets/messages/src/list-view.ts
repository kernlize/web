import { el } from './dom.js';
import type { ListRow } from './view-model.js';

function tile(row: ListRow): HTMLElement {
  const element = el('span', 'tile', row.initials);
  element.style.setProperty('--hue', String(row.hue));
  element.setAttribute('aria-hidden', 'true');
  return element;
}

/**
 * The button is named by the person alone, so it can be found by that name.
 * The unread count is its description, kept in a hidden note beside it.
 */
function listItem(row: ListRow, index: number): HTMLLIElement {
  const button = el('button', 'thread-item');
  button.type = 'button';
  button.dataset.key = row.key;
  button.title = row.title;
  button.setAttribute('aria-label', row.title);
  if (row.current) button.setAttribute('aria-current', 'true');

  const text = el('span', 'thread-text');
  text.append(el('span', 'thread-name truncate', row.title));
  if (row.preview) text.append(el('span', 'thread-preview truncate', row.preview));

  const meta = el('span', 'thread-meta');
  if (row.time) meta.append(el('span', 'thread-time', row.time));
  if (row.unread > 0) meta.append(el('span', 'badge', row.unread > 99 ? '99+' : String(row.unread)));

  button.append(tile(row), text, meta);
  const item = el('li');
  item.append(button);
  if (row.unread > 0) {
    const note = el('span', '', `${row.unread} unread`);
    note.id = `thread-note-${index}`;
    note.hidden = true;
    button.setAttribute('aria-describedby', note.id);
    item.append(note);
  }
  return item;
}

function focusedKey(list: HTMLElement): string | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && list.contains(active) ? active.dataset.key ?? null : null;
}

export function threadButton(list: HTMLElement, key: string): HTMLButtonElement | null {
  const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('.thread-item'));
  return buttons.find((button) => button.dataset.key === key) ?? null;
}

/** Rebuild the list; focus stays on the thread it was on. */
export function renderList(list: HTMLElement, rows: readonly ListRow[]): void {
  const focused = focusedKey(list);
  list.replaceChildren(...rows.map(listItem));
  if (focused) threadButton(list, focused)?.focus();
}

/** Arrow keys walk the list like any other list of choices. */
export function moveListFocus(list: HTMLElement, event: KeyboardEvent): void {
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (step === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
  const buttons = Array.from(list.querySelectorAll<HTMLButtonElement>('.thread-item'));
  const index = buttons.findIndex((button) => button === document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  buttons[Math.min(buttons.length - 1, Math.max(0, index + step))]?.focus();
}
