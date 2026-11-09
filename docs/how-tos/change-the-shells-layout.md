# Change the shell's layout

Where the shell puts its windows is decided by a layout: a pure function from the open windows to one rectangle each. The shell offers four, the person steps through them from the bar, and the choice is remembered. This page changes that set: the spacing, which layouts are on offer, and a layout of your own. All of it is in one file, `apps/web/src/shell/windows.ts`.

To change more than the arrangement, such as how focus, stacking or minimising work, [write your own window manager](./write-a-window-manager.md) instead.

## In the shell

The bar's layout control shows the layout in use. Each click switches to the next one and wraps to the first:

| Id | Shown as | Arrangement |
| --- | --- | --- |
| `floating` | floating | Each window keeps its own rectangle. The only layout in which windows can be dragged and resized. The default. |
| `dwindle` | tiled | Each window after the first takes half of what is left, splitting into columns, then rows, in turn. |
| `columns` | columns | Equal-width columns, in opening order. |
| `master-stack` | main and stack | The front-most window takes six tenths of the width on the left; the rest stack on the right. |

The choice is kept under `kernl:layout:v1` as the layout's id ([Persistence](../concepts/persistence.md#keys-the-shell-app-writes)). At 720 px wide or less the layout does not apply: every window fills the desktop ([Layouts](../concepts/layouts.md#narrow-desktops)).

## Change the spacing

`createShellLayouts` builds the registry the shell uses. kernl's four layouts take one `LayoutOptions` between them: `gap` is the pixels between windows, and `margin` the pixels between the windows and the desktop edge, which defaults to `gap`. The shell asks for 8 and 0:

```ts
import { createDefaultLayouts, type LayoutRegistry } from '@kernlize/core/wm';

export function createShellLayouts(): LayoutRegistry {
  return createDefaultLayouts({ gap: 12, margin: 12 });
}
```

## Choose which layouts are offered

To drop a layout, reorder them, or give one its own options, build the registry yourself. The first layout registered is the one a person starts in when they have not chosen yet.

```ts
import { createColumnsLayout, createLayoutRegistry, createMasterStackLayout, floatingLayout, type LayoutRegistry } from '@kernlize/core/wm';

export function createShellLayouts(): LayoutRegistry {
  return createLayoutRegistry([
    { id: 'master-stack', label: 'main and stack', strategy: createMasterStackLayout({ ratio: 0.7, gap: 8, margin: 0 }) },
    { id: 'columns', label: 'columns', strategy: createColumnsLayout({ gap: 8, margin: 0 }) },
    { id: 'floating', label: 'floating', strategy: floatingLayout, freeform: true },
  ]);
}
```

`freeform: true` says the person places the windows and the strategy hands their rectangles back. The window manager lets windows be moved and resized only in a freeform layout; leave it off for a layout that arranges.

## Add a layout of your own

A layout is a `LayoutStrategy`: `arrange(windows, area)` returns `{ id, rect }` for each window it places. Adding one is a single `register`:

```ts
import { createDefaultLayouts, type LayoutRegistry, type LayoutStrategy } from '@kernlize/core/wm';

/** Equal rows, top to bottom. */
const rowsLayout: LayoutStrategy = {
  arrange(windows, area) {
    const shown = windows.filter((window) => !window.minimized);
    const edge = (index: number): number => Math.round(area.y + (index * area.h) / shown.length);
    return shown.map((window, index) => ({
      id: window.id,
      rect: { x: area.x, y: edge(index), w: area.w, h: edge(index + 1) - edge(index) },
    }));
  },
};

export function createShellLayouts(): LayoutRegistry {
  const layouts = createDefaultLayouts({ gap: 8, margin: 0 });
  layouts.register({ id: 'rows', label: 'rows', strategy: rowsLayout });
  return layouts;
}
```

The bar lists it after the others, and the person's choice of it is remembered like any other. What a strategy can rely on, and what it should do:

- **It is pure.** It gets a snapshot and returns rectangles. It keeps no state and touches no DOM; the manager calls it after every change.
- **`minimized` means "leave this one out".** It is true for a minimised window and for one whose applet was stopped. A window the strategy returns no placement for keeps its own rectangle.
- **`focused` marks the front-most window**, not strictly the focused one. The front-most window stays marked while the person works in the shell's own panels, so a layout that follows focus does not reshuffle when a panel opens.
- **Windows arrive in opening order**, and that order never changes.
- **Return whole pixels, and round edges rather than sizes**, as `rowsLayout` does. Two windows that share an edge then agree on where it is; rounding each width on its own can leave a one-pixel hole or overlap.
- **`rect` is each window's own rectangle**: where the person last put it in a freeform layout. A strategy that arranges can ignore it.

Registering an id twice throws `invalid:duplicate-layout`.

## Name it in plain words

The label is what a person reads in the bar, so it follows the [public vocabulary](../policies/public-vocabulary.md): say what the layout looks like. kernl's own `dwindle` is shown as "tiled" and `master-stack` as "main and stack" for that reason. The id is never shown.

If you rename an id, people who chose it under the old name would start in the default layout. `RENAMED_LAYOUTS` in `windows.ts` maps a stored id to its new one; it already carries `tiled`, the id `dwindle` had in earlier builds.

## Check it

- `apps/web/features/shell-windows.feature` specifies the shell's set: the spacing, the order the control steps through, and what is remembered. Change the scenario with the code.
- `packages/core/features/layout-registry.feature` shows a custom layout registered and arranged, which is a good template for a scenario of your own.
- In the preview (`/app/?preview=1`), open both sample applets and step through the layouts. An applet must not restart when the layout changes: the manager moves rectangles, never frames.

## Related

- [Layouts](../concepts/layouts.md), the concept
- [Write your own window manager](./write-a-window-manager.md)
- [`@kernlize/core`](../packages/core.md#layouts-and-the-window-manager)
