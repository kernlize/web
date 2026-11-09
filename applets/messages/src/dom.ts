export function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = '',
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export interface KeyedRow {
  key: string;
}

/**
 * Bring `parent`'s children in line with `rows`, reusing the node of every row
 * whose content did not change. The message log is a live region, so replacing
 * untouched nodes would make a screen reader read old messages again.
 */
export function syncRows<R extends KeyedRow>(
  parent: HTMLElement,
  rows: readonly R[],
  build: (row: R) => HTMLElement,
): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(parent.children)) {
    if (child instanceof HTMLElement && child.dataset.key) existing.set(child.dataset.key, child);
  }
  let cursor: Element | null = parent.firstElementChild;
  for (const row of rows) {
    const signature = JSON.stringify(row);
    const known = existing.get(row.key);
    existing.delete(row.key);
    let node = known;
    if (!node || node.dataset.signature !== signature) {
      node = build(row);
      node.dataset.key = row.key;
      node.dataset.signature = signature;
      known?.replaceWith(node);
      if (known === cursor) cursor = node;
    }
    if (node === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(node, cursor);
  }
  for (const stale of existing.values()) stale.remove();
}
