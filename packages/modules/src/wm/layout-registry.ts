import type { LayoutStrategy } from '@kehto/wm';
import { createColumnsLayout, createDwindleLayout, createMasterStackLayout, floatingLayout, type LayoutOptions } from './layouts.js';

/** A layout as the person picks it: a stable id and the words the shell shows. */
export interface LayoutChoice {
  /** Stable id, kept in storage as the person's choice. */
  readonly id: string;
  /** What the shell calls the layout. */
  readonly label: string;
}

/** A named layout strategy. */
export interface LayoutEntry extends LayoutChoice {
  /** Where the windows go. */
  readonly strategy: LayoutStrategy;
  /**
   * True when the person places the windows and the strategy hands their rectangles back.
   * A window manager lets windows be moved and resized only in a freeform layout.
   */
  readonly freeform?: boolean;
}

/** The layouts a window manager offers, in the order the shell lists them. */
export interface LayoutRegistry {
  /**
   * Add a layout.
   * @throws `invalid:duplicate-layout` when the id is taken.
   */
  register(entry: LayoutEntry): void;
  /** The layout with this id, if there is one. */
  get(id: string): LayoutEntry | undefined;
  /** Every layout, in registration order. */
  list(): readonly LayoutEntry[];
}

/**
 * Create a layout registry, optionally holding some layouts already.
 *
 * @param entries - Layouts to register, in order.
 * @returns A `LayoutRegistry`.
 * @example
 * ```ts
 * const layouts = createLayoutRegistry([{ id: 'floating', label: 'floating', strategy: floatingLayout, freeform: true }]);
 * layouts.register({ id: 'columns', label: 'columns', strategy: createColumnsLayout({ gap: 8 }) });
 * layouts.list().map((layout) => layout.id); // ['floating', 'columns']
 * ```
 */
export function createLayoutRegistry(entries: readonly LayoutEntry[] = []): LayoutRegistry {
  const layouts = new Map<string, LayoutEntry>();
  const registry: LayoutRegistry = {
    register(entry) {
      if (layouts.has(entry.id)) throw new Error('invalid:duplicate-layout');
      layouts.set(entry.id, entry);
    },
    get: (id) => layouts.get(id),
    list: () => [...layouts.values()],
  };
  for (const entry of entries) registry.register(entry);
  return registry;
}

/**
 * The layouts kernl ships, floating first: `floating`, `dwindle` (shown as "tiled"), `columns` and
 * `master-stack` (shown as "main and stack"). The spacing applies to the three that arrange windows.
 *
 * @param options - Gap between windows and margin at the container edge, for the tiling layouts.
 * @returns A `LayoutRegistry` holding the four layouts; register your own on top.
 * @example
 * ```ts
 * const layouts = createDefaultLayouts({ gap: 8, margin: 0 });
 * layouts.register({ id: 'rows', label: 'rows', strategy: myRowsLayout });
 * ```
 */
export function createDefaultLayouts(options: LayoutOptions = {}): LayoutRegistry {
  return createLayoutRegistry([
    { id: 'floating', label: 'floating', strategy: floatingLayout, freeform: true },
    { id: 'dwindle', label: 'tiled', strategy: createDwindleLayout(options) },
    { id: 'columns', label: 'columns', strategy: createColumnsLayout(options) },
    { id: 'master-stack', label: 'main and stack', strategy: createMasterStackLayout(options) },
  ]);
}
