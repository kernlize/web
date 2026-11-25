/**
 * Layouts and the window manager, on their own: `@kernlize/core/wm` loads none of the network stack, so a
 * shell can import it before the core itself. Everything here is also exported from `@kernlize/core`.
 */
export type { LayoutStrategy, Rect, WindowPlacement, WindowState } from '@kehto/wm';
export { createColumnsLayout, createDwindleLayout, createMasterStackLayout, floatingLayout, type LayoutOptions, type MasterStackOptions } from './layouts.js';
export { createDefaultLayouts, createLayoutRegistry, type LayoutChoice, type LayoutEntry, type LayoutRegistry } from './layout-registry.js';
export {
  createWindowManager,
  type ManagedWindow,
  type VisibilityTarget,
  type WindowManager,
  type WindowManagerOptions,
  type WindowManagerState,
  type WindowSize,
} from './window-manager.js';
