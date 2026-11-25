import type { ServiceHandler } from '@kehto/runtime';
import type { ShortcutKey } from '@kernlize/kernel';

export type { ShortcutKey } from '@kernlize/kernel';
import { createKeysService } from '@kehto/services';


/** The host's settings for applets' keyboard shortcuts. */
export interface ShortcutSettings {
  /** Chords the shell keeps for itself, such as `'Alt+/'`; an applet asking for one is answered without a binding. */
  readonly reserved?: readonly string[];
  /** Where key presses outside applets are heard; the page's `document` by default, and nowhere when there is none. */
  readonly target?: EventTarget;
}

/** Options for {@link createShortcutsService}. */
export interface ShortcutsOptions extends ShortcutSettings {
  /** Whether a window is the focused one, as the shell's window manager reports it. */
  readonly isFocused: (windowId: string) => boolean;
}

/** The `keys` service, with the listener it must give back. */
export type ShortcutsService = ServiceHandler & { destroy(): void };

/** What the service reads from a `keydown` on the shell's own page. */
interface PagePress extends ShortcutKey {
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  readonly defaultPrevented?: boolean;
  readonly target: object;
}

/** Elements that take a key press for themselves: typing, choosing, pressing. */
const CONTROL_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY']);

/** While a listener runs, an event's target is the object it was dispatched on, never null. */
function isControl(target: object): boolean {
  const { tagName, isContentEditable } = target as { tagName?: unknown; isContentEditable?: unknown };
  return isContentEditable === true || (typeof tagName === 'string' && CONTROL_TAGS.has(tagName.toUpperCase()));
}

/** A key press on the shell's page that is the shell's own business: handled, being composed, or aimed at a control. */
function isShellsOwn(press: PagePress): boolean {
  return press.defaultPrevented === true || press.isComposing === true || isControl(press.target);
}

function pageTarget(options: ShortcutSettings): EventTarget | undefined {
  return options.target ?? (typeof document === 'undefined' ? undefined : document);
}

/**
 * The `keys` domain (D-054): kehto's reference service, which binds the key an
 * applet asks for, tells it which keys it holds and runs its action when the
 * key is pressed outside every applet, behind three rules of kernl's. A key
 * pressed on the shell's own page reaches applets only when the shell did not
 * use it: not one it handled, and not one typed into a field or pressed on a
 * button. The action runs in the focused window only, where kehto would run it
 * in every window that bound the key, so two windows of one applet do not both
 * act. And a key that ran an action does nothing else on the page. A key
 * pressed inside an applet never comes through here: the frame knows its own
 * bindings and runs the action itself.
 *
 * @param options - Reserved chords, where keys are heard and the focus source.
 * @returns The service for the registry; call `destroy()` to stop listening.
 * @example
 * ```ts
 * registry.keys = createShortcutsService({ reserved: ['Alt+/'], isFocused: (windowId) => wm.isFocused(windowId) });
 * ```
 */
export function createShortcutsService(options: ShortcutsOptions): ShortcutsService {
  // kehto listens here, not on the page, so only the presses kernl lets through reach it.
  const relayed = new EventTarget();
  const service = createKeysService({ listenerTarget: relayed, ...(options.reserved ? { reservedChords: options.reserved } : {}) });
  const page = pageTarget(options);
  let acted = false;

  const onKeydown = (event: Event): void => {
    const press = event as Event & PagePress;
    if (isShellsOwn(press)) return;
    const { key, code, ctrlKey, altKey, shiftKey, metaKey } = press;
    acted = false;
    relayed.dispatchEvent(Object.assign(new Event('keydown'), { key, code, ctrlKey, altKey, shiftKey, metaKey, repeat: press.repeat }));
    if (acted) event.preventDefault();
  };
  page?.addEventListener('keydown', onKeydown);

  return {
    ...service,
    handleMessage(windowId, message, send) {
      // kehto keeps this `send` for the window's later pushes, so the focus check rides on it.
      service.handleMessage(windowId, message, (reply) => {
        if (reply.type !== 'keys.action') return send(reply);
        if (!options.isFocused(windowId)) return;
        acted = true;
        send(reply);
      });
    },
    destroy() {
      page?.removeEventListener('keydown', onKeydown);
      service.destroy();
    },
  };
}
