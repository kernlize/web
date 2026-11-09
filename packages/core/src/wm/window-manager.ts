import type { Rect } from '@kehto/wm';
import type { WindowVisibility } from '@kernlize/guard';
import { BehaviorSubject, type Observable } from 'rxjs';
import { createDefaultLayouts, type LayoutChoice, type LayoutEntry, type LayoutRegistry } from './layout-registry.js';

/** A width and a height in CSS pixels. */
export interface WindowSize {
  readonly w: number;
  readonly h: number;
}

/** One window as the manager has it now. */
export interface ManagedWindow {
  readonly id: string;
  /** Where the window is drawn: the layout's placement, or the window's own rectangle when the layout leaves it out. */
  readonly rect: Rect;
  /** Stacking order. The highest is in front. */
  readonly z: number;
  /** Whether the person is working in this window. */
  readonly focused: boolean;
  readonly minimised: boolean;
  /** Its applet was stopped. The window stays until it is closed, takes no focus and is never reported visible. */
  readonly stopped: boolean;
}

/** Everything a shell needs to draw its windows. A new object is published after every change. */
export interface WindowManagerState {
  /** Every window, in opening order. The order never changes while a window lives, so a frame is never moved in the document. */
  readonly windows: readonly ManagedWindow[];
  readonly focusedId: string | null;
  /** The layout in use. */
  readonly layout: LayoutChoice;
  /** The rectangle windows are laid out in. */
  readonly area: Rect;
  /** The area is narrow: every window fills it, whatever the layout. */
  readonly compact: boolean;
  /** Whether the person may move and resize windows now. */
  readonly freeform: boolean;
}

/** What the manager reports a window's visibility to. An `AppletHandle` is one. */
export interface VisibilityTarget {
  setVisibility(visibility: WindowVisibility): void;
}

/**
 * Where windows are, which one has the person's attention, and what the guard is told about each.
 *
 * A shell draws from `state$` and calls the methods from its own events. One obligation is fixed for
 * every implementation: `visibilityOf` and the reports sent to each attached target must be true. A
 * window the person cannot see is not visible, and a window they are not working in is not focused.
 * The guard holds a hidden applet's requests and gives an unfocused one a smaller budget on the
 * strength of these reports. Everything else is the implementation's choice.
 */
export interface WindowManager {
  /** The current state, then every state after it. */
  readonly state$: Observable<WindowManagerState>;
  /** The current state. */
  snapshot(): WindowManagerState;
  /** The layouts the person can choose between. */
  layouts(): readonly LayoutChoice[];
  /** Add a window in front, focused. Opening an id that is already open brings that window to the front. */
  open(id: string): void;
  /** Remove a window and stop reporting to it. */
  close(id: string): void;
  /** Bring a window to the front and give it the person's attention. Shows it if it was minimised. */
  focus(id: string): void;
  /** The person is working in the shell itself; no window is focused. */
  blur(): void;
  /** Hide a window without closing it. */
  minimise(id: string): void;
  /** Move or resize a window. Ignored unless the state is `freeform`. */
  move(id: string, rect: Rect): void;
  /** Mark a window's applet as stopped: it loses focus, is no longer reported to, and waits to be closed. */
  stop(id: string): void;
  /** Report this window's visibility to `target`, now and after every change. Called once per window, when its applet is mounted. */
  attach(id: string, target: VisibilityTarget): void;
  /** What the guard is told about a window when it asks. An unknown window is neither visible nor focused. */
  visibilityOf(id: string): WindowVisibility;
  /** Set the rectangle windows are laid out in. */
  setArea(area: Rect): void;
  /**
   * Switch layout.
   * @throws `invalid:unknown-layout` when no layout has this id.
   */
  setLayout(id: string): void;
  /** Tell the manager whether the page itself can be seen. A hidden page hides every window. */
  setPageVisible(visible: boolean): void;
  /** Stop reporting and complete `state$`. */
  destroy(): void;
}

/** Options for {@link createWindowManager}. */
export interface WindowManagerOptions {
  /** The layouts on offer. Defaults to `createDefaultLayouts()`. */
  readonly layouts?: LayoutRegistry;
  /** The id of the layout to start in. Defaults to the first registered; an id that is not registered is ignored. */
  readonly layout?: string;
  /** The rectangle to lay windows out in until `setArea` is called. Defaults to 1280 by 800 at the origin. */
  readonly area?: Rect;
  /** At or below this area width every window fills the area. Defaults to 720; 0 turns it off. */
  readonly compactWidth?: number;
  /** The size a new window opens at. Defaults to 720 by 660. */
  readonly windowSize?: WindowSize;
  /** The smallest a window may be made. Defaults to 280 by 160. */
  readonly minSize?: WindowSize;
  /** Called with the id after every `setLayout`, so the choice can be remembered. */
  readonly onLayout?: (id: string) => void;
  /** Clock for `msSinceFocusGain`. Defaults to `Date.now`. */
  readonly now?: () => number;
}

interface Entry {
  readonly id: string;
  own: Rect;
  z: number;
  minimised: boolean;
  stopped: boolean;
  focusGainedAt: number;
  target: VisibilityTarget | undefined;
}

interface Desk {
  readonly entries: Entry[];
  layout: LayoutEntry;
  area: Rect;
  focusedId: string | null;
  pageVisible: boolean;
  nextZ: number;
}

const DEFAULT_AREA: Rect = { x: 0, y: 0, w: 1280, h: 800 };
const DEFAULT_SIZE: WindowSize = { w: 720, h: 660 };
const MIN_SIZE: WindowSize = { w: 280, h: 160 };
const DEFAULT_COMPACT_WIDTH = 720;
const CASCADE_STEP = 32;
const CASCADE_WRAP = 8;

/** Keep a window inside the area, no smaller than `min` and no larger than the area. */
function clamp(rect: Rect, area: Rect, min: WindowSize): Rect {
  const w = Math.min(Math.max(rect.w, min.w), area.w);
  const h = Math.min(Math.max(rect.h, min.h), area.h);
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.w - w);
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.h - h);
  return { x, y, w, h };
}

/** Step each new window down and right so it does not hide the one before; start over after eight. */
function cascade(index: number, area: Rect, size: WindowSize, min: WindowSize): Rect {
  const offset = (index % CASCADE_WRAP) * CASCADE_STEP;
  return clamp({ x: area.x + 40 + offset, y: area.y + 24 + offset, ...size }, area, min);
}

function startingLayout(layouts: LayoutRegistry, wanted: string | undefined): LayoutEntry {
  const layout = layouts.get(wanted ?? '') ?? layouts.list()[0];
  if (!layout) throw new Error('invalid:no-layouts');
  return layout;
}

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const find = (desk: Desk, id: string): Entry | undefined => desk.entries.find((entry) => entry.id === id);

/** The front-most window the person can see. */
function front(desk: Desk): Entry | undefined {
  return desk.entries
    .filter((entry) => !entry.minimised && !entry.stopped)
    .reduce<Entry | undefined>((best, entry) => (best && best.z > entry.z ? best : entry), undefined);
}

function visibility(desk: Desk, id: string, now: () => number): WindowVisibility {
  const entry = find(desk, id);
  if (!entry) return { visible: false, focused: false };
  const visible = desk.pageVisible && !entry.minimised && !entry.stopped;
  const focused = visible && desk.focusedId === id;
  return focused ? { visible, focused, msSinceFocusGain: now() - entry.focusGainedAt } : { visible, focused };
}

/**
 * Run the layout. A strategy is told the front-most window is the focused one, so an arrangement that
 * follows focus does not reshuffle when the person turns to the shell's own panels and no window is focused.
 */
function arrange(desk: Desk, compact: boolean): Map<string, Rect> {
  const placed = new Map<string, Rect>();
  if (compact) return placed;
  const leader = front(desk);
  const states = desk.entries.map((entry) => ({ id: entry.id, focused: entry === leader, minimized: entry.minimised || entry.stopped, rect: { ...entry.own } }));
  for (const placement of desk.layout.strategy.arrange(states, { ...desk.area })) placed.set(placement.id, placement.rect);
  return placed;
}

function describe(desk: Desk, compactWidth: number): WindowManagerState {
  const compact = desk.area.w <= compactWidth;
  const placed = arrange(desk, compact);
  const rectOf = (entry: Entry): Rect => ({ ...(compact ? desk.area : (placed.get(entry.id) ?? entry.own)) });
  return {
    windows: desk.entries.map((entry) => ({
      id: entry.id,
      rect: rectOf(entry),
      z: entry.z,
      focused: desk.focusedId === entry.id,
      minimised: entry.minimised,
      stopped: entry.stopped,
    })),
    focusedId: desk.focusedId,
    layout: { id: desk.layout.id, label: desk.layout.label },
    area: { ...desk.area },
    compact,
    freeform: !compact && desk.layout.freeform === true,
  };
}

/**
 * Create kernl's window manager: windows cascade as they open, the person picks a layout from a
 * registry, a narrow area shows one window at a time, and each attached applet is told whether it
 * can be seen and whether it has the person's attention.
 *
 * It holds no DOM and draws nothing. Feed it the shell's events, draw from `state$`, and answer
 * `KernlHost.getVisibility` with `visibilityOf`.
 *
 * @param options - Layouts, starting layout, sizes and a clock.
 * @returns A `WindowManager`.
 * @throws `invalid:no-layouts` when the registry is empty.
 * @example
 * ```ts
 * const windows = createWindowManager({ layouts: createDefaultLayouts({ gap: 8, margin: 0 }) });
 * windows.state$.subscribe((state) => draw(state.windows));
 * windows.setArea({ x: 0, y: 0, w: 1440, h: 900 });
 * windows.open(plan.windowId);
 * windows.attach(plan.windowId, kernl.mount(plan, frame));
 * windows.setLayout('columns');
 * ```
 */
export function createWindowManager(options: WindowManagerOptions = {}): WindowManager {
  const layouts = options.layouts ?? createDefaultLayouts();
  const now = options.now ?? Date.now;
  const compactWidth = options.compactWidth ?? DEFAULT_COMPACT_WIDTH;
  const size = options.windowSize ?? DEFAULT_SIZE;
  const min = options.minSize ?? MIN_SIZE;
  const desk: Desk = { entries: [], layout: startingLayout(layouts, options.layout), area: options.area ?? DEFAULT_AREA, focusedId: null, pageVisible: true, nextZ: 1 };
  const state = new BehaviorSubject(describe(desk, compactWidth));

  const report = (): void => {
    for (const entry of desk.entries) entry.target?.setVisibility(visibility(desk, entry.id, now));
  };
  const publish = (): void => state.next(describe(desk, compactWidth));
  /** Focus moved or a window was shown or hidden: tell the applets first, then redraw. */
  const changed = (): void => {
    report();
    publish();
  };
  const focusOn = (entry: Entry | undefined): void => {
    desk.focusedId = entry?.id ?? null;
    if (entry) entry.focusGainedAt = now();
  };
  const leave = (id: string): void => {
    if (desk.focusedId === id) focusOn(front(desk));
  };

  const manager: WindowManager = {
    state$: state.asObservable(),
    snapshot: () => state.value,
    layouts: () => layouts.list().map(({ id, label }) => ({ id, label })),
    open(id) {
      if (!find(desk, id)) {
        const own = cascade(desk.entries.length, desk.area, size, min);
        desk.entries.push({ id, own, z: 0, minimised: false, stopped: false, focusGainedAt: 0, target: undefined });
      }
      manager.focus(id);
    },
    close(id) {
      const index = desk.entries.findIndex((entry) => entry.id === id);
      if (index === -1) return;
      desk.entries.splice(index, 1);
      leave(id);
      changed();
    },
    focus(id) {
      const entry = find(desk, id);
      if (!entry || entry.stopped) return;
      entry.minimised = false;
      if (desk.focusedId !== id) focusOn(entry);
      entry.z = desk.nextZ++;
      changed();
    },
    blur() {
      if (desk.focusedId === null) return;
      focusOn(undefined);
      changed();
    },
    minimise(id) {
      const entry = find(desk, id);
      if (!entry) return;
      entry.minimised = true;
      leave(id);
      changed();
    },
    move(id, rect) {
      const entry = find(desk, id);
      if (!entry || !state.value.freeform) return;
      entry.own = clamp(rect, desk.area, min);
      publish();
    },
    stop(id) {
      const entry = find(desk, id);
      if (!entry) return;
      entry.stopped = true;
      entry.target = undefined;
      leave(id);
      changed();
    },
    attach(id, target) {
      const entry = find(desk, id);
      if (!entry || entry.target) return;
      entry.target = target;
      target.setVisibility(visibility(desk, id, now));
    },
    visibilityOf: (id) => visibility(desk, id, now),
    setArea(area) {
      if (sameRect(area, desk.area)) return;
      desk.area = { ...area };
      for (const entry of desk.entries) entry.own = clamp(entry.own, desk.area, min);
      publish();
    },
    setLayout(id) {
      const layout = layouts.get(id);
      if (!layout) throw new Error('invalid:unknown-layout');
      desk.layout = layout;
      options.onLayout?.(id);
      publish();
    },
    setPageVisible(visible) {
      if (visible === desk.pageVisible) return;
      desk.pageVisible = visible;
      report();
    },
    destroy() {
      for (const entry of desk.entries) entry.target = undefined;
      state.complete();
    },
  };
  return manager;
}
