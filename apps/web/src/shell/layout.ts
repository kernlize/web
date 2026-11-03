export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const GAP = 8;

/**
 * Dwindle tiling: the first window takes half the area, the remainder is split
 * again for the next, alternating direction, so the last windows dwindle into
 * a corner. Pure; the window store feeds it the visible windows in opening order.
 */
export function dwindle(area: Rect, count: number): Rect[] {
  if (count <= 0) return [];
  const rects: Rect[] = [];
  let remaining = area;
  for (let index = 0; index < count; index += 1) {
    if (index === count - 1) {
      rects.push(remaining);
      break;
    }
    const vertical = index % 2 === 0;
    if (vertical) {
      const width = Math.floor((remaining.width - GAP) / 2);
      rects.push({ ...remaining, width });
      remaining = { ...remaining, x: remaining.x + width + GAP, width: remaining.width - width - GAP };
    } else {
      const height = Math.floor((remaining.height - GAP) / 2);
      rects.push({ ...remaining, height });
      remaining = { ...remaining, y: remaining.y + height + GAP, height: remaining.height - height - GAP };
    }
  }
  return rects;
}

/** Keep a floating window inside the desktop with its title bar reachable. */
export function clampRect(rect: Rect, area: Rect, minWidth = 280, minHeight = 160): Rect {
  const width = Math.min(Math.max(rect.width, minWidth), area.width);
  const height = Math.min(Math.max(rect.height, minHeight), area.height);
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

/** Stagger new windows so they do not stack exactly on top of each other. */
export function cascade(index: number, area: Rect, size: { width: number; height: number }): Rect {
  const step = 32;
  const offset = (index % 8) * step;
  return clampRect({ x: area.x + 40 + offset, y: area.y + 24 + offset, ...size }, area);
}
