# Layouts

`@kehto/wm` ships only a contract: a `LayoutStrategy` is a pure `arrange(windows, containerRect)` that returns one `WindowPlacement` (`{ id, rect }`) per window it places. Each `WindowState` it receives has an `id`, `focused`, `minimized` and a `rect` of `{ x, y, w, h }`. kehto leaves the strategies to the shell. `@kernl/core` supplies four in `packages/core/src/wm/layouts.ts`, and the shell app uses tiling of its own, described at the end of this page.

## The four strategies

| Export | Kind | Arrangement |
| --- | --- | --- |
| `floatingLayout` | constant | Every window keeps the rectangle it has, copied. Minimised windows are returned too, unchanged. |
| `createDwindleLayout(options?)` | factory | Each window after the first takes half of the area that is left, splitting into columns, then rows, in turn, so the last window ends in the smallest corner. The last window takes all that remains. |
| `createColumnsLayout(options?)` | factory | Equal-width columns, full height, in window order. |
| `createMasterStackLayout(options?)` | factory | One master window on the left, the rest stacked in equal rows on the right. The focused window is the master; with no focused window, the first is. A single window fills the container. |

The three tiling factories take `LayoutOptions`: `gap`, the pixels between windows and from the container edge, default `0`. `createMasterStackLayout` also takes `ratio`, the master's share of the width after the gap, default `0.6`.

Rules shared by the tiling strategies:

- **Minimised windows are left out.** They get no placement, so the visible windows share the whole container. A strategy given only minimised windows returns an empty list.
- **Rectangles are rounded** to whole pixels.
- **Order is the caller's.** Dwindle and columns place windows in the order they are passed; only master-stack looks at `focused`.

`packages/core/features/layouts.feature` specifies all four.

```ts
import { createMasterStackLayout } from '@kernl/core';

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

## How the shell lays out windows

The shell app (`apps/web`) does not call the `@kernl/core` strategies. Its window store (`apps/web/src/shell/window-store.svelte.ts`) has two modes, chosen from the bar's layout control and remembered in `kernl:layout:v1` ([Persistence](./persistence.md)):

| Mode | Behaviour |
| --- | --- |
| `floating` (default) | Each window keeps its own rectangle. New windows cascade from near the top left in 32 px steps, and a moved or resized window, like every window when the desktop resizes, is kept inside the desktop at no less than 280 × 160 px, or the desktop's own size when that is smaller. |
| `tiled` | The shell's own `dwindle(area, count)` in `apps/web/src/shell/layout.ts` places the windows that are neither minimised nor stopped, in opening order, with an 8 px gap between them and none at the desktop edge. It is the same arrangement as `createDwindleLayout`, written against the shell's `{ x, y, width, height }` rectangle. |

At 720 px wide or less the shell is compact: every window fills the desktop, whatever the mode ([Alpha status](../alpha-status.md#what-does-not-work-yet)).

Minimising matters beyond layout. A minimised window is hidden, and the guard watches a hidden window more closely: its requests are held until it is shown again, and its resource requests are counted against the hidden-window allowance ([Guard](./guard.md)).

An embedding host that renders its own windows can pass any `LayoutStrategy`, including the four above, to whatever arranges them; the core does not hold a layout of its own.

## Related

- [Architecture](./architecture.md)
- [`@kernl/core`](../packages/core.md)
- [Embed kernl core](../how-tos/embed-kernl-core.md)
