import { createDefaultLayouts, createWindowManager, type LayoutChoice, type LayoutRegistry, type Rect, type WindowManager } from '@kernlize/core/wm';
import { DEFAULT_WINDOW_SIZE, LAYOUT_KEY, type StorageLike } from './contract';

/*
 * How the shell manages windows is decided in this file and nowhere else (D-022).
 *
 * To add a layout, register it in `createShellLayouts`. To change how windows behave altogether,
 * return your own `WindowManager` from `createShellWindowManager`: the rest of the shell only
 * draws what the manager publishes and tells it what the person did.
 */

export const TITLE_BAR_HEIGHT = 36;

/** Ids an earlier build stored under `LAYOUT_KEY`, and what each is called now. */
const RENAMED_LAYOUTS: Readonly<Record<string, string>> = { tiled: 'dwindle' };

/** The layouts the bar's layout control steps through: kernl's four, with 8 px between windows and none at the desktop edge. */
export function createShellLayouts(): LayoutRegistry {
  return createDefaultLayouts({ gap: 8, margin: 0 });
}

/** The layout the person last chose, by its current id. */
export function rememberedLayout(storage: StorageLike): string | undefined {
  const stored = storage.getItem(LAYOUT_KEY);
  if (stored === null) return undefined;
  return RENAMED_LAYOUTS[stored] ?? stored;
}

/** The shell's window manager: kernl's own, starting in the remembered layout and remembering the next choice. */
export function createShellWindowManager(storage: StorageLike): WindowManager {
  return createWindowManager({
    layouts: createShellLayouts(),
    layout: rememberedLayout(storage),
    windowSize: DEFAULT_WINDOW_SIZE,
    onLayout: (id) => storage.setItem(LAYOUT_KEY, id),
  });
}

/** Where the applet's frame sits: the window's rectangle, under its title bar. */
export function frameRect(rect: Rect): Rect {
  return { x: rect.x, y: rect.y + TITLE_BAR_HEIGHT, w: rect.w, h: Math.max(0, rect.h - TITLE_BAR_HEIGHT) };
}

/** The layout the bar's control switches to next: the one after the current, wrapping to the first. */
export function layoutAfter(choices: readonly LayoutChoice[], currentId: string): LayoutChoice | undefined {
  const index = choices.findIndex((choice) => choice.id === currentId);
  return choices[(index + 1) % Math.max(choices.length, 1)];
}
