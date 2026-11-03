import type { WindowVisibility } from '@kernl/guard';
import type { AppletHandle, AppletStatus, FrameLike, MountPlan } from './contract';
import { DEFAULT_WINDOW_SIZE, LAYOUT_KEY } from './contract';
import { cascade, clampRect, dwindle, type Rect } from './layout';

export type LayoutMode = 'floating' | 'tiled';

export const TITLE_BAR_HEIGHT = 36;

export interface ShellWindow {
  readonly id: string;
  readonly plan: MountPlan;
  rect: Rect;
  z: number;
  minimised: boolean;
  status: AppletStatus;
  revoked?: string;
  handle?: AppletHandle;
  focusGainedAt?: number;
}

type Mount = (plan: MountPlan, frame: FrameLike) => AppletHandle;

function readLayout(): LayoutMode {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'tiled' ? 'tiled' : 'floating';
  } catch {
    return 'floating';
  }
}

/**
 * Every open applet window. The array order is the opening order and never
 * changes while a window lives: the iframe layer keys on it, and a reordered
 * iframe node would reload the applet.
 */
export class WindowStore {
  windows = $state<ShellWindow[]>([]);
  layout = $state<LayoutMode>(readLayout());
  focusedId = $state<string | null>(null);
  area = $state<Rect>({ x: 0, y: 0, width: 1280, height: 800 });
  dragging = $state(false);
  pageVisible = $state(true);
  #nextZ = 1;
  #onVisibility: (window: ShellWindow, visibility: WindowVisibility) => void = (window, visibility) =>
    window.handle?.setVisibility(visibility);

  readonly visible = $derived(this.windows.filter((window) => !window.minimised && !window.revoked));
  readonly tiles = $derived(dwindle(this.area, this.visible.length));

  get(id: string): ShellWindow | undefined {
    return this.windows.find((window) => window.id === id);
  }

  /** The chrome rectangle, floating or tiled. */
  rectOf(window: ShellWindow): Rect {
    if (this.layout === 'floating') return window.rect;
    const index = this.visible.indexOf(window);
    return this.tiles[index] ?? window.rect;
  }

  /** Where the iframe sits: the chrome rectangle minus its title bar. */
  frameRectOf(window: ShellWindow): Rect {
    const rect = this.rectOf(window);
    return { x: rect.x, y: rect.y + TITLE_BAR_HEIGHT, width: rect.width, height: Math.max(0, rect.height - TITLE_BAR_HEIGHT) };
  }

  visibilityOf(id: string): WindowVisibility {
    const window = this.get(id);
    const visible = Boolean(window) && this.pageVisible && !window!.minimised && !window!.revoked;
    const focused = visible && this.focusedId === id;
    const since = window?.focusGainedAt;
    return focused && since !== undefined ? { visible, focused, msSinceFocusGain: Date.now() - since } : { visible, focused };
  }

  open(plan: MountPlan): ShellWindow {
    const window: ShellWindow = {
      id: plan.windowId,
      plan,
      rect: cascade(this.windows.length, this.area, DEFAULT_WINDOW_SIZE),
      z: this.#nextZ++,
      minimised: false,
      status: 'mounting',
    };
    this.windows.push(window);
    this.focus(window.id);
    return window;
  }

  /** Called once by the iframe layer when the frame element exists. */
  attach(id: string, frame: FrameLike, mount: Mount): void {
    const window = this.get(id);
    if (!window || window.handle) return;
    const handle = mount(window.plan, frame);
    window.handle = handle;
    handle.status$.subscribe((status) => {
      const current = this.get(id);
      if (current) current.status = status;
    });
    this.#publish(window);
  }

  focus(id: string): void {
    const window = this.get(id);
    if (!window || window.revoked) return;
    const previous = this.focusedId;
    if (window.minimised) window.minimised = false;
    if (previous !== id) {
      window.focusGainedAt = Date.now();
      this.focusedId = id;
    }
    window.z = this.#nextZ++;
    this.#publishAll();
  }

  /** The user is working in the chrome; no applet holds focus. */
  blur(): void {
    if (this.focusedId === null) return;
    this.focusedId = null;
    this.#publishAll();
  }

  minimise(id: string): void {
    const window = this.get(id);
    if (!window) return;
    window.minimised = true;
    if (this.focusedId === id) this.focusedId = this.topmost()?.id ?? null;
    this.#publishAll();
  }

  move(id: string, rect: Rect): void {
    const window = this.get(id);
    if (window) window.rect = clampRect(rect, this.area);
  }

  close(id: string): void {
    const window = this.get(id);
    if (!window) return;
    window.handle?.close();
    this.windows = this.windows.filter((item) => item.id !== id);
    if (this.focusedId === id) this.focusedId = this.topmost()?.id ?? null;
    this.#publishAll();
  }

  markRevoked(id: string, reason: string): void {
    const window = this.get(id);
    if (!window) return;
    window.revoked = reason;
    window.status = 'revoked';
    if (this.focusedId === id) this.focusedId = this.topmost()?.id ?? null;
  }

  setLayout(layout: LayoutMode): void {
    this.layout = layout;
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // Private windows refuse storage; the layout still applies to this page.
    }
  }

  setArea(area: Rect): void {
    this.area = area;
    for (const window of this.windows) window.rect = clampRect(window.rect, area);
  }

  setPageVisible(visible: boolean): void {
    this.pageVisible = visible;
    this.#publishAll();
  }

  topmost(): ShellWindow | undefined {
    return this.visible.reduce<ShellWindow | undefined>((best, window) => (best && best.z > window.z ? best : window), undefined);
  }

  #publish(window: ShellWindow): void {
    this.#onVisibility(window, this.visibilityOf(window.id));
  }

  #publishAll(): void {
    for (const window of this.windows) this.#publish(window);
  }
}
