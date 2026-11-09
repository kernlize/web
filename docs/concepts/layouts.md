# Layouts

Where a shell puts its windows is the part of kernl most likely to be changed, so it is built to be: a layout is a pure function, the layouts on offer are a registry, and everything else about windows sits behind one interface that can be replaced whole ([D-022](../decisions.md#d-022)).

`@kehto/wm` ships only the contract. A `LayoutStrategy` is a pure `arrange(windows, containerRect)` that returns one `WindowPlacement` (`{ id, rect }`) per window it places. Each `WindowState` it receives has an `id`, `focused`, `minimized` and a `rect` of `{ x, y, w, h }`. kehto leaves the strategies, and the manager that calls them, to the shell. `@kernlize/core` supplies both, and exports them a second time from `@kernlize/core/wm`, an entry that loads none of the network stack.

## The four strategies

| Export | Kind | Arrangement |
| --- | --- | --- |
| `floatingLayout` | constant | Every window keeps the rectangle it has, copied. Minimised windows are returned too, unchanged. |
| `createDwindleLayout(options?)` | factory | Each window after the first takes half of the area that is left, splitting into columns, then rows, in turn, so the last window ends in the smallest corner. The last window takes all that remains. |
| `createColumnsLayout(options?)` | factory | Equal-width columns, full height, in window order. |
| `createMasterStackLayout(options?)` | factory | One master window on the left, the rest stacked in equal rows on the right. The focused window is the master; with no focused window, the first is. A single window fills the container. |

The three tiling factories take `LayoutOptions`: `gap`, the pixels between windows, default `0`, and `margin`, the pixels between the windows and the container edge, which defaults to `gap`. `createMasterStackLayout` also takes `ratio`, the master's share of the width after the gap, default `0.6`.

Rules shared by the tiling strategies:

- **Minimised windows are left out.** They get no placement, so the visible windows share the whole container. A strategy given only minimised windows returns an empty list.
- **Rectangles are whole pixels, rounded at the edges.** Two windows that share an edge agree on where it is, so a width that does not divide evenly never leaves a hole or an overlap.
- **Order is the caller's.** Dwindle and columns place windows in the order they are passed; only master-stack looks at `focused`.

`packages/core/features/layouts.feature` specifies all four.

```ts
import { createMasterStackLayout } from '@kernlize/core';

const layout = createMasterStackLayout({ ratio: 0.5, gap: 8 });
const placements = layout.arrange(
  [
    { id: 'notes', focused: false, minimized: false, rect: { x: 0, y: 0, w: 400, h: 300 } },
    { id: 'pulse', focused: true, minimized: false, rect: { x: 0, y: 0, w: 400, h: 300 } },
    { id: 'clock', focused: false, minimized: true, rect: { x: 0, y: 0, w: 400, h: 300 } },
  ],
  { x: 0, y: 0, w: 1200, h: 800 },
);
// pulse is the master at { x: 8, y: 8, w: 588, h: 784 }; notes fills the stack at { x: 604, y: 8, w: 588, h: 784 }; clock is not placed
```

## The registry

A window manager offers the layouts in a `LayoutRegistry`: `register(entry)`, `get(id)` and `list()`, in registration order. A `LayoutEntry` is an `id` that is stored as the person's choice, a `label` the shell shows, the `strategy`, and `freeform`, which is true when the person places the windows and the strategy hands their rectangles back.

`createDefaultLayouts(options?)` returns a registry holding kernl's four, floating first; `createLayoutRegistry(entries?)` starts from whatever it is given.

| Id | Label | Strategy | Freeform |
| --- | --- | --- | --- |
| `floating` | floating | `floatingLayout` | yes |
| `dwindle` | tiled | `createDwindleLayout(options)` | no |
| `columns` | columns | `createColumnsLayout(options)` | no |
| `master-stack` | main and stack | `createMasterStackLayout(options)` | no |

```ts
import { createDefaultLayouts, type LayoutStrategy } from '@kernlize/core/wm';

declare const spiralLayout: LayoutStrategy;

const layouts = createDefaultLayouts({ gap: 8, margin: 0 });
layouts.register({ id: 'spiral', label: 'spiral', strategy: spiralLayout });
layouts.list().map((layout) => layout.id); // ['floating', 'dwindle', 'columns', 'master-stack', 'spiral']
```

A second registration of the same id throws `invalid:duplicate-layout`. `packages/core/features/layout-registry.feature` specifies the registry.

## The window manager

`createWindowManager(options?)` returns a `WindowManager`: the one object that knows where each window is, which is in front, which has the person's attention, and what the guard is told about each. It holds no DOM. A shell feeds it events (`open`, `focus`, `blur`, `minimise`, `move`, `close`, `stop`, `setArea`, `setLayout`, `setPageVisible`) and draws from `state$`, which publishes a new `WindowManagerState` after every change.

What kernl's manager does:

- **Opening.** A new window opens in front, focused, at the size in `windowSize` (720 × 660 by default), stepped down and right by 32 px from the one before; the cascade starts over after eight. A window never opens larger than the area.
- **Arranging.** After every change it calls the current layout's strategy with every window, in opening order. A window the strategy leaves out, as the tiling strategies do for minimised ones, keeps its own rectangle. A stopped window is passed as minimised.
- **The front-most window leads.** A strategy is told the front-most window is the focused one, even while the person is working in the shell's own panels and no window is. A layout that follows focus, such as master-stack, therefore does not reshuffle when a panel opens.
- **Moving.** `move` applies only while the state is `freeform`. The window stays inside the area and no smaller than `minSize` (280 × 160 by default). Resizing the area pulls floating windows back inside it.
- **Focus.** `focus` brings a window to the front and shows it if it was minimised. When the focused window is minimised, closed or stopped, focus goes to the front-most window that is left.
- **Remembering.** `onLayout(id)` is called after every `setLayout`, and `layout` names the layout to start in. An id nobody registered is ignored and the first layout is used.

### Narrow desktops

At an area width of `compactWidth` or less, 720 by default, the state is `compact`: every window's rectangle is the whole area, whatever the layout, and windows cannot be moved. `compactWidth: 0` turns it off.

### What the guard is told

`attach(id, target)` hands the manager something with a `setVisibility` method, which an `AppletHandle` is. The manager reports to it at once, and again whenever focus, minimising, closing, stopping or the page's own visibility changes anything. `visibilityOf(id)` gives the same answer on demand, for `KernlHost.getVisibility`.

kernl's manager counts a window as visible when the page is visible and the window is neither minimised nor stopped, and as focused when it is also the window the person is working in. It does not look for a window wholly covered by another, so the windows behind the front one on a compact desktop are reported visible ([Alpha status](../alpha-status.md#what-does-not-work-yet)).

This matters beyond layout. The guard holds a hidden window's requests until it is shown, counts its resource requests against the hidden-window allowance, and gives an unfocused window a smaller budget ([Guard](./guard.md)). Telling the guard the truth is the one thing every window manager must do; [Write your own window manager](../how-tos/write-a-window-manager.md#the-one-rule) states the rule.

`packages/core/features/window-manager.feature` specifies all of the above.

## How the shell uses them

The shell app decides its window management in one file, `apps/web/src/shell/windows.ts`:

- `createShellLayouts()` is kernl's four layouts with 8 px between windows and none at the desktop edge. The bar's layout control steps through them in order.
- `createShellWindowManager(storage)` is `createWindowManager` with those layouts, starting in the layout stored under `kernl:layout:v1` and storing the next choice there ([Persistence](./persistence.md)).

The rest of the shell knows the manager only through the `WindowManager` interface: `WindowStore` keeps which applet is in which window and passes the person's actions on, and the components draw what the manager publishes. To add or change a layout, see [Change the shell's layout](../how-tos/change-the-shells-layout.md); to replace the manager, see [Write your own window manager](../how-tos/write-a-window-manager.md).

An embedding host that renders its own windows can use the same pieces: any `LayoutStrategy`, the registry, or the whole manager. `createKernl` itself holds no layout and no window manager.

## Related

- [Change the shell's layout](../how-tos/change-the-shells-layout.md)
- [Write your own window manager](../how-tos/write-a-window-manager.md)
- [Architecture](./architecture.md)
- [`@kernlize/core`](../packages/core.md#layouts-and-the-window-manager)
- [Embed kernl core](../how-tos/embed-kernl-core.md)
