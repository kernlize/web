---
"@kernlize/core": patch
---

Window management is a replaceable interface, and layouts are a registry (D-022).

- New `createWindowManager` and the `WindowManager` interface: placement, focus, stacking, minimising and what the guard is told about each window, with no DOM, publishing `WindowManagerState` on `state$`.
- New `createLayoutRegistry` and `createDefaultLayouts`: the layouts a window manager offers. `createDefaultLayouts` holds `floating`, `dwindle`, `columns` and `master-stack`.
- New entry `@kernlize/core/wm`, exporting the layouts, the registry and the window manager without the network stack. The same names are exported from the main entry, which now also re-exports `LayoutStrategy`, `Rect`, `WindowPlacement` and `WindowState` from `@kehto/wm`.
- `LayoutOptions.margin` sets the space between the windows and the container edge and defaults to `gap`.
- The tiling layouts round rectangle edges rather than sizes, so neighbours never overlap or leave a hole when the space does not divide evenly. A width that does not divide evenly can differ by one pixel from before.
