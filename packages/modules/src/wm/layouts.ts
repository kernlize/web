import type { LayoutStrategy, Rect, WindowPlacement, WindowState } from '@kehto/wm';

/** Spacing options shared by the tiling layouts. */
export interface LayoutOptions {
  /** Pixels between windows. Defaults to 0. */
  readonly gap?: number;
  /** Pixels between the windows and the container edge. Defaults to `gap`. */
  readonly margin?: number;
}

/** Options for {@link createMasterStackLayout}. */
export interface MasterStackOptions extends LayoutOptions {
  /** Share of the width the master window takes. Defaults to 0.6. */
  readonly ratio?: number;
}

/**
 * Windows keep the rectangles they have. The strategy for a free-floating desktop.
 *
 * @example
 * ```ts
 * floatingLayout.arrange(windows, { x: 0, y: 0, w: 1200, h: 800 });
 * // every window keeps the rect it already had
 * ```
 */
export const floatingLayout: LayoutStrategy = {
  arrange: (windows) => windows.map(({ id, rect }) => ({ id, rect: { ...rect } })),
};

function visible(windows: ReadonlyArray<WindowState>): WindowState[] {
  return windows.filter((window) => !window.minimized);
}

interface Spacing {
  readonly gap: number;
  readonly margin: number;
}

function spacing(options: LayoutOptions): Spacing {
  const gap = options.gap ?? 0;
  return { gap, margin: options.margin ?? gap };
}

function inset(rect: Rect, margin: number): Rect {
  return { x: rect.x + margin, y: rect.y + margin, w: Math.max(0, rect.w - margin * 2), h: Math.max(0, rect.h - margin * 2) };
}

/** Round the edges, not the sizes: two windows that share an edge then agree on where it is, so they never overlap or leave a hole. */
function place(id: string, rect: Rect): WindowPlacement {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  return { id, rect: { x, y, w: Math.round(rect.x + rect.w) - x, h: Math.round(rect.y + rect.h) - y } };
}

function splitRows(area: Rect, count: number, gap: number): Rect[] {
  const h = (area.h - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({ x: area.x, y: area.y + index * (h + gap), w: area.w, h }));
}

function splitColumns(area: Rect, count: number, gap: number): Rect[] {
  const w = (area.w - gap * (count - 1)) / count;
  return Array.from({ length: count }, (_, index) => ({ x: area.x + index * (w + gap), y: area.y, w, h: area.h }));
}

/**
 * The dwindle layout: each window after the first takes half of the remaining
 * area, splitting vertically then horizontally in turn, so the last window
 * ends up in the smallest corner. Minimised windows are left out.
 *
 * @param options - Gap between windows and margin at the container edge.
 * @returns A `LayoutStrategy`.
 * @example
 * ```ts
 * createDwindleLayout({ gap: 8 }).arrange(windows, { x: 0, y: 0, w: 1200, h: 800 });
 * ```
 */
export function createDwindleLayout(options: LayoutOptions = {}): LayoutStrategy {
  const { gap, margin } = spacing(options);
  return {
    arrange(windows, containerRect) {
      const shown = visible(windows);
      const placements: WindowPlacement[] = [];
      let remaining = inset(containerRect, margin);
      shown.forEach((window, index) => {
        if (index === shown.length - 1) {
          placements.push(place(window.id, remaining));
          return;
        }
        const splitVertically = index % 2 === 0;
        const [first, rest] = splitVertically ? splitColumns(remaining, 2, gap) : splitRows(remaining, 2, gap);
        placements.push(place(window.id, first as Rect));
        remaining = rest as Rect;
      });
      return placements;
    },
  };
}

/**
 * Equal-width columns in window order. Minimised windows are left out.
 *
 * @param options - Gap between windows and margin at the container edge.
 * @returns A `LayoutStrategy`.
 * @example
 * ```ts
 * createColumnsLayout().arrange(windows, container)[0]?.rect.x; // 0
 * ```
 */
export function createColumnsLayout(options: LayoutOptions = {}): LayoutStrategy {
  const { gap, margin } = spacing(options);
  return {
    arrange(windows, containerRect) {
      const shown = visible(windows);
      const columns = splitColumns(inset(containerRect, margin), shown.length, gap);
      return shown.map((window, index) => place(window.id, columns[index] as Rect));
    },
  };
}

/**
 * One master window on the left, the rest stacked on the right. The focused
 * window is the master; without focus, the first window is. Minimised windows
 * are left out and a single window fills the container.
 *
 * @param options - Master width ratio, gap and margin.
 * @returns A `LayoutStrategy`.
 * @example
 * ```ts
 * createMasterStackLayout({ ratio: 0.5, gap: 4 }).arrange(windows, container);
 * ```
 */
export function createMasterStackLayout(options: MasterStackOptions = {}): LayoutStrategy {
  const { gap, margin } = spacing(options);
  const ratio = options.ratio ?? 0.6;
  return {
    arrange(windows, containerRect) {
      const shown = visible(windows);
      if (shown.length === 0) return [];
      const area = inset(containerRect, margin);
      const master = shown.find((window) => window.focused) ?? (shown[0] as WindowState);
      const stack = shown.filter((window) => window !== master);
      if (stack.length === 0) return [place(master.id, area)];
      const masterWidth = (area.w - gap) * ratio;
      const masterRect: Rect = { x: area.x, y: area.y, w: masterWidth, h: area.h };
      const stackArea: Rect = { x: area.x + masterWidth + gap, y: area.y, w: area.w - masterWidth - gap, h: area.h };
      const rows = splitRows(stackArea, stack.length, gap);
      return [place(master.id, masterRect), ...stack.map((window, index) => place(window.id, rows[index] as Rect))];
    },
  };
}
