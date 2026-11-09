# Write your own window manager

kernl has opinions about windows: they cascade as they open, one layout arranges them all, a narrow screen shows one at a time. Those opinions live behind one interface, `WindowManager`, so that a shell with different ones can replace them whole: tabs, workspaces, snapping, a kiosk with a single applet. This page says what the interface asks of you, states the one rule you may not bend, and builds a small manager from nothing.

If you only want a different arrangement of the same windows, [change the shell's layout](./change-the-shells-layout.md) instead. That is one registration, not a manager.

## The seam

The shell makes its window manager in one place, `createShellWindowManager` in `apps/web/src/shell/windows.ts`, and from there on knows it only as a `WindowManager` ([D-022](../decisions.md#d-022)). The split is:

| Whose | What |
| --- | --- |
| The window manager | Where each window is, which is in front, which has the person's attention, what is minimised, and what the guard is told about each. |
| The shell (`WindowStore`, the Svelte components) | Which applet is in which window, mounting its frame, drawing the chrome, and passing the person's actions on. |
| `@kernlize/core` | Everything about the applet itself: verifying it, the sandbox, grants, consent, the guard. A window manager cannot reach any of it. |

The manager holds no DOM. The shell draws from the state it publishes and calls its methods:

| Member | When the shell calls it | What it must do |
| --- | --- | --- |
| `state$`, `snapshot()` | To draw. `state$` gives the state now and after every change. | Publish a new `WindowManagerState` whenever anything in it changes. Keep `windows` in opening order: the shell keys its frames on that order, and a frame that moves in the document reloads its applet. |
| `layouts()`, `setLayout(id)` | The bar's layout control. | List what the person can choose between. One entry is fine. Throw `invalid:unknown-layout` for an id you do not offer. |
| `open(id)` | An applet was planned and is about to be mounted. | Add the window, in front and focused. |
| `attach(id, target)` | Once, when the applet's frame is mounted. `target` is the applet's handle. | Report the window's visibility to `target` now, and again after every change. See [the rule](#the-one-rule). |
| `focus(id)` | A pointer went down in the window, its frame took focus, or its dock entry was chosen. | Give it the person's attention and show it if it was minimised. |
| `blur()` | The person turned to the shell: the desktop, a panel, the launcher. | No window is focused. |
| `minimise(id)`, `close(id)` | The window's buttons. | Hide it, or forget it and stop reporting to it. |
| `move(id, rect)` | A drag, a resize or an arrow key on the title bar, only while `state.freeform` is true. | Move it, or ignore the call. |
| `stop(id)` | The core stopped the applet, for example after a quarantine. The frame is already gone. | Keep the window so the person can read why and close it; give it no focus and report to it no more. |
| `setArea(rect)` | The desktop was measured or resized. | Lay windows out inside it. |
| `setPageVisible(visible)` | The browser tab was hidden or shown. | Hide or show every window to the guard. |
| `visibilityOf(id)` | The guard asks about a window synchronously, through `KernlHost.getVisibility`. | Answer by the same rule as the reports. An id you do not know is `{ visible: false, focused: false }`. |
| `destroy()` | The shell is going away. | Stop reporting and complete `state$`. |

`state.compact` and `state.freeform` are yours to set: the shell squares off its window chrome when `compact` is true, and offers dragging and the resize handle only when `freeform` is. When `layouts()` has one entry, the bar leaves its layout control out.

## The one rule

Everything above is yours to decide. One thing is not:

> **What the manager tells the guard about a window must be true.** A window is `visible` only while the person can see it. It is `focused` only while it is the one window the person is working in. `msSinceFocusGain` is the time since it last gained that focus.

The guard acts on these reports. A hidden applet's requests are held until it is shown, and its downloads count against a small allowance; an applet the person is not working in gets a fraction of the budget ([Guard](../concepts/guard.md#layers)). A manager that calls a window visible when it is behind a tab, on another workspace or scrolled off screen hands a hidden applet the budget of a watched one. No setting was changed and nobody was asked: the guard was simply told something false. That is why this is a rule and the rest is taste.

In practice:

- **Hidden means hidden to the person.** Minimised, on another tab or workspace, wholly off screen, or on a browser tab that is itself hidden: `visible: false`.
- **At most one window is focused**, and none while the person is in the shell's own panels. A window that is not visible is never focused.
- **Report when it changes, not only when asked.** Call `target.setVisibility` for every attached window whose answer may have changed: the guard releases what it held for a window at the moment it is told the window is visible.
- **Do not restart the clock.** `focus(id)` on the window that already has focus must not reset `msSinceFocusGain`; the shell calls `focus` on every click inside a window.
- **When you cannot tell, say hidden.** The cost of a wrong "hidden" is a request that waits. The cost of a wrong "visible" is one nobody was watching.

What the rule does not cover: a window manager cannot weaken the sandbox, the content policy, grants or consent, whatever it reports. Those never read visibility.

kernl's own manager applies the rule as far as it can see: a window is visible when the page is, and the window is neither minimised nor stopped. It does not look for a window that is wholly covered by another, so the windows behind the front one on a narrow desktop are reported visible ([Alpha status](../alpha-status.md#what-does-not-work-yet)). A manager that knows more, as the one below does, should say more.

## A manager from nothing

This one shows a single window at a time, full size; the others wait in the bar's dock, which lists every window the manager calls minimised. It is the whole of a `WindowManager` in about a hundred lines, and unlike kernl's own it knows exactly which window the person can see.

```ts
import { BehaviorSubject } from 'rxjs';
import type { WindowVisibility } from '@kernlize/guard';
import type { LayoutChoice, Rect, VisibilityTarget, WindowManager, WindowManagerState } from '@kernlize/core/wm';

const LAYOUT: LayoutChoice = { id: 'one', label: 'one at a time' };

export function createOneAtATimeManager(now: () => number = Date.now): WindowManager {
  const ids: string[] = [];
  const stopped = new Set<string>();
  const targets = new Map<string, VisibilityTarget>();
  let area: Rect = { x: 0, y: 0, w: 1280, h: 800 };
  let shown: string | null = null;
  let focused = false;
  let focusedAt = 0;
  let pageVisible = true;

  // The rule: visible only if it is the window on show, focused only if the person is in it.
  const visibilityOf = (id: string): WindowVisibility => {
    const visible = pageVisible && id === shown && !stopped.has(id);
    return visible && focused ? { visible, focused, msSinceFocusGain: now() - focusedAt } : { visible, focused: false };
  };

  const describe = (): WindowManagerState => ({
    windows: ids.map((id) => ({
      id,
      rect: { ...area },
      z: id === shown ? 2 : 1,
      focused: focused && id === shown,
      minimised: id !== shown,
      stopped: stopped.has(id),
    })),
    focusedId: focused ? shown : null,
    layout: LAYOUT,
    area: { ...area },
    compact: true,
    freeform: false,
  });

  const state = new BehaviorSubject(describe());
  const changed = (): void => {
    for (const [id, target] of targets) target.setVisibility(visibilityOf(id));
    state.next(describe());
  };
  const show = (id: string | null): void => {
    shown = id;
    focused = id !== null && !stopped.has(id);
    focusedAt = now();
    changed();
  };
  const another = (id: string): string | null => [...ids].reverse().find((other) => other !== id && !stopped.has(other)) ?? null;

  return {
    state$: state.asObservable(),
    snapshot: () => state.value,
    layouts: () => [LAYOUT],
    open(id) {
      if (!ids.includes(id)) ids.push(id);
      show(id);
    },
    close(id) {
      if (!ids.includes(id)) return;
      ids.splice(ids.indexOf(id), 1);
      targets.delete(id);
      stopped.delete(id);
      if (shown === id) show(another(id));
      else changed();
    },
    focus(id) {
      const already = shown === id && focused;
      if (ids.includes(id) && !stopped.has(id) && !already) show(id);
    },
    blur() {
      if (!focused) return;
      focused = false;
      changed();
    },
    minimise(id) {
      if (shown === id) show(another(id));
    },
    move: () => undefined,
    stop(id) {
      if (!ids.includes(id)) return;
      stopped.add(id);
      targets.delete(id);
      if (shown === id) focused = false;
      changed();
    },
    attach(id, target) {
      if (!ids.includes(id) || targets.has(id)) return;
      targets.set(id, target);
      target.setVisibility(visibilityOf(id));
    },
    visibilityOf,
    setArea(next) {
      area = { ...next };
      state.next(describe());
    },
    setLayout(id) {
      if (id !== LAYOUT.id) throw new Error('invalid:unknown-layout');
    },
    setPageVisible(visible) {
      pageVisible = visible;
      changed();
    },
    destroy() {
      targets.clear();
      state.complete();
    },
  };
}
```

Three things in it are the rule at work. `visibilityOf` is the only place visibility is decided, so the answer the guard gets when it asks and the reports it is sent cannot disagree. `changed` reports to every attached window before it publishes, because showing one window hides another. And `focus` returns early for the window that already has focus, so a click inside it does not restart its clock.

## Put it in the shell

Return it from `createShellWindowManager`. Nothing else in the shell changes:

<!-- sample:continues -->

```ts
export function createShellWindowManager(): WindowManager {
  return createOneAtATimeManager();
}
```

The shell passes its storage to `createShellWindowManager`; a manager with nothing to remember can ignore it. If yours has a choice worth keeping, store the id as kernl's does, through the `onLayout` option of `createWindowManager` or your own call to `storage.setItem`.

To build on kernl's manager instead of starting over, call `createWindowManager(options)` and wrap what it returns: pass the calls you do not change straight through, and replace the ones you do. `WindowManagerOptions` already covers the layouts, the starting layout, the size a window opens at, the smallest it may be made, and the width at which the desktop turns compact (`compactWidth: 0` turns that off).

## Outside the shell

`WindowManager` and `createWindowManager` are exported from `@kernlize/core/wm`, and need nothing from the shell app. A page that [embeds the core](./embed-kernl-core.md) and shows more than one applet can use kernl's manager for placement and reporting, and draw the windows its own way:

```ts
import { createWindowManager, type Rect } from '@kernlize/core/wm';
import type { AppletHandle, KernlHost } from '@kernlize/core';

declare function place(windowId: string, rect: Rect, hidden: boolean): void;

const windows = createWindowManager({ layout: 'columns', compactWidth: 0 });
windows.state$.subscribe((state) => {
  for (const window of state.windows) place(window.id, window.rect, window.minimised);
});
document.addEventListener('visibilitychange', () => windows.setPageVisible(document.visibilityState === 'visible'));

/** Call when a window's frame has been mounted. */
export function track(handle: AppletHandle): void {
  windows.open(handle.windowId);
  windows.attach(handle.windowId, handle);
}

export const getVisibility: KernlHost['getVisibility'] = (windowId) => windows.visibilityOf(windowId);
```

`@kernlize/core/wm` loads none of the network stack, so it can be imported before the core itself; the same names are exported from `@kernlize/core`.

## Check it

- `packages/core/features/window-manager.feature` is the specification of kernl's manager. The scenarios under "the guard is told the truth" are the ones to keep for any manager: copy them, change the steps to drive yours, and add one for each way your manager can hide a window.
- In the preview (`/app/?preview=1`), open both sample applets. Hide one your manager's way, press **Flood the shell** in the other, and open the guard panel: the events belong to the applet you can see.
- Switch browser tabs and back. Every window should be reported hidden, then as it was.
- An applet must never restart because your manager changed something. If one does, `state.windows` changed order, or the shell's frames were re-keyed.

## Related

- [Layouts](../concepts/layouts.md), the concept
- [Change the shell's layout](./change-the-shells-layout.md)
- [Guard](../concepts/guard.md#layers), what visibility and focus change
- [`@kernlize/core`](../packages/core.md#layouts-and-the-window-manager)
