import type { Attachment } from 'svelte/attachments';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/**
 * Keep Tab inside a dialog, move focus in on attach and give it back on detach.
 * `initial` picks the element that receives focus first; the first focusable otherwise.
 */
export function trapFocus(initial?: () => HTMLElement | null | undefined): Attachment<HTMLElement> {
  return (node) => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initial?.() ?? focusables(node)[0] ?? node;
    queueMicrotask(() => target.focus());

    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const items = focusables(node);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKeydown);
    return () => {
      node.removeEventListener('keydown', onKeydown);
      previous?.focus();
    };
  };
}
