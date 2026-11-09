/* global $state, $derived */
import type { LayoutChoice, ManagedWindow, Rect, WindowManager, WindowManagerState } from '@kernlize/core/wm';
import type { WindowVisibility } from '@kernlize/guard';
import type { AppletHandle, AppletStatus, FrameLike, MountPlan } from './contract';
import { frameRect, layoutAfter } from './windows';

/** A window as the shell draws it: where the manager put it, and the applet inside. */
export interface ShellWindow extends ManagedWindow {
  readonly plan: MountPlan;
  readonly status: AppletStatus;
  /** Why the applet was stopped, in plain words. */
  readonly revoked?: string;
}

interface Applet {
  readonly id: string;
  readonly plan: MountPlan;
  readonly status: AppletStatus;
  readonly revoked?: string;
}

type Mount = (plan: MountPlan, frame: FrameLike) => AppletHandle;

/**
 * The shell's side of its windows: which applet is in each, and the manager's latest state as
 * something Svelte can draw from. Where windows go, which is focused and what the guard is told
 * are the `WindowManager`'s business (D-022); this store only passes the person's actions on.
 */
export class WindowStore {
  readonly manager: WindowManager;
  dragging = $state(false);
  #state: WindowManagerState;
  #applets = $state.raw<readonly Applet[]>([]);
  readonly #handles = new Map<string, AppletHandle>();

  /** Every window in opening order. The order never changes while a window lives: a reordered iframe node would reload its applet. */
  readonly windows: readonly ShellWindow[];
  readonly layout: LayoutChoice;
  /** The layout the bar's control switches to next. */
  readonly nextLayout: LayoutChoice;
  /** False when the manager offers a single layout, and the bar has nothing to switch to. */
  readonly canSwitchLayout: boolean;
  readonly compact: boolean;
  /** Whether the person may drag and resize windows now. */
  readonly freeform: boolean;

  constructor(manager: WindowManager) {
    this.manager = manager;
    this.#state = $state.raw(manager.snapshot());
    this.windows = $derived(
      this.#state.windows.flatMap((placed) => {
        const applet = this.#applets.find((item) => item.id === placed.id);
        return applet ? [{ ...placed, ...applet }] : [];
      }),
    );
    this.layout = $derived(this.#state.layout);
    this.nextLayout = $derived(layoutAfter(manager.layouts(), this.#state.layout.id) ?? this.#state.layout);
    this.canSwitchLayout = $derived(this.nextLayout.id !== this.layout.id);
    this.compact = $derived(this.#state.compact);
    this.freeform = $derived(this.#state.freeform);
    manager.state$.subscribe((state) => {
      this.#state = state;
    });
  }

  get(id: string): ShellWindow | undefined {
    return this.windows.find((window) => window.id === id);
  }

  /** Where the iframe sits: the window's rectangle minus its title bar. */
  frameRectOf(window: ShellWindow): Rect {
    return frameRect(window.rect);
  }

  visibilityOf(id: string): WindowVisibility {
    return this.manager.visibilityOf(id);
  }

  open(plan: MountPlan): void {
    this.#applets = [...this.#applets, { id: plan.windowId, plan, status: 'mounting' }];
    this.manager.open(plan.windowId);
  }

  /** Called by the iframe layer when the frame element exists. Mounts once per window, however often it is called. */
  attach(id: string, frame: FrameLike, mount: Mount): void {
    const applet = this.#applets.find((item) => item.id === id);
    if (!applet || this.#handles.has(id)) return;
    const handle = mount(applet.plan, frame);
    this.#handles.set(id, handle);
    handle.status$.subscribe((status) => this.#update(id, { status }));
    this.manager.attach(id, handle);
  }

  focus(id: string): void {
    this.manager.focus(id);
  }

  /** The user is working in the chrome; no applet holds focus. */
  blur(): void {
    this.manager.blur();
  }

  minimise(id: string): void {
    this.manager.minimise(id);
  }

  move(id: string, rect: Rect): void {
    this.manager.move(id, rect);
  }

  close(id: string): void {
    this.#handles.get(id)?.close();
    this.#handles.delete(id);
    this.#applets = this.#applets.filter((item) => item.id !== id);
    this.manager.close(id);
  }

  markRevoked(id: string, reason: string): void {
    this.#handles.delete(id);
    this.#update(id, { revoked: reason, status: 'revoked' });
    this.manager.stop(id);
  }

  setLayout(id: string): void {
    this.manager.setLayout(id);
  }

  setArea(area: Rect): void {
    this.manager.setArea(area);
  }

  setPageVisible(visible: boolean): void {
    this.manager.setPageVisible(visible);
  }

  #update(id: string, change: Partial<Pick<Applet, 'status' | 'revoked'>>): void {
    this.#applets = this.#applets.map((item) => (item.id === id ? { ...item, ...change } : item));
  }
}
