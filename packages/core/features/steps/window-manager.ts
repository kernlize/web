import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import type { WindowVisibility } from '@kernlize/guard';
import {
  createDefaultLayouts,
  createLayoutRegistry,
  createWindowManager,
  type LayoutRegistry,
  type LayoutStrategy,
  type Rect,
  type WindowManager,
  type WindowManagerOptions,
  type WindowManagerState,
} from '@kernlize/core';
import type { CoreWorld } from './world.js';

/** A layout a developer might write: equal rows, top to bottom. */
const rowsLayout: LayoutStrategy = {
  arrange(windows, area) {
    const shown = windows.filter((window) => !window.minimized);
    const h = area.h / shown.length;
    return shown.map((window, index) => ({ id: window.id, rect: { x: area.x, y: area.y + index * h, w: area.w, h } }));
  },
};

interface WmScratch {
  options: { -readonly [Key in keyof WindowManagerOptions]: WindowManagerOptions[Key] };
  registry?: LayoutRegistry;
  manager?: WindowManager;
  clock: number;
  published: number;
  ended: boolean;
  remembered: string[];
  reports: Map<string, WindowVisibility[]>;
  placed?: readonly Rect[];
  error?: unknown;
}

interface WmWorld extends CoreWorld {
  wm?: WmScratch;
}

function wm(world: WmWorld): WmScratch {
  world.wm ??= { options: {}, clock: 0, published: 0, ended: false, remembered: [], reports: new Map() };
  return world.wm;
}

function manager(world: WmWorld): WindowManager {
  const { manager: made } = wm(world);
  if (!made) throw new Error('create the window manager first');
  return made;
}

function registry(world: WmWorld): LayoutRegistry {
  const made = wm(world).registry;
  if (!made) throw new Error('create a layout registry first');
  return made;
}

const state = (world: WmWorld): WindowManagerState => manager(world).snapshot();
const yes = (value: boolean): string => (value ? 'yes' : 'no');
const names = (list: string): string[] => list.split(',').map((name) => name.trim()).filter(Boolean);

function watch(world: WmWorld, made: WindowManager): void {
  const scratch = wm(world);
  scratch.manager = made;
  made.state$.subscribe({ next: () => (scratch.published += 1), complete: () => (scratch.ended = true) });
}

function attempt(world: WmWorld, body: () => void): void {
  try {
    body();
  } catch (error) {
    wm(world).error = error;
  }
}

const refusal = (world: WmWorld): string => (wm(world).error instanceof Error ? (wm(world).error as Error).message : 'nothing');

Given('the default layouts', (world: WmWorld) => {
  wm(world).registry = createDefaultLayouts();
});

Given('the default layouts with a gap of {int} and a margin of {int}', (world: WmWorld, gap: number, margin: number) => {
  wm(world).registry = createDefaultLayouts({ gap, margin });
});

Given('an empty layout registry', (world: WmWorld) => {
  wm(world).registry = createLayoutRegistry();
});

When('a layout {string} labelled {string} is registered', (world: WmWorld, id: string, label: string) => {
  attempt(world, () => registry(world).register({ id, label, strategy: rowsLayout }));
});

When('the layout {string} arranges {int} windows in {int} by {int}', (world: WmWorld, id: string, count: number, w: number, h: number) => {
  const windows = Array.from({ length: count }, (_, index) => ({ id: `w${index}`, focused: false, minimized: false, rect: { x: 0, y: 0, w: 10, h: 10 } }));
  wm(world).placed = registry(world).get(id)?.strategy.arrange(windows, { x: 0, y: 0, w, h }).map((placement) => placement.rect) ?? [];
});

Then('the layout placed them at:', (world: WmWorld, table: DataTable) => {
  expect(wm(world).placed).toEqual(table.hashes().map((row) => ({ x: Number(row.x), y: Number(row.y), w: Number(row.w), h: Number(row.h) })));
});

Then('the layouts are:', (world: WmWorld, table: DataTable) => {
  const listed = registry(world).list().map((layout) => ({ id: layout.id, label: layout.label, freeform: yes(layout.freeform === true) }));
  expect(listed).toEqual(table.hashes());
});

Then('there are no layouts', (world: WmWorld) => {
  expect(registry(world).list()).toEqual([]);
});

Then('there is no layout {string}', (world: WmWorld, id: string) => {
  expect(registry(world).get(id)).toBeUndefined();
});

Then('the layout registry refuses with {string}', (world: WmWorld, reason: string) => {
  expect(refusal(world)).toBe(reason);
});

Given('the window manager offers the default layouts with a gap of {int} and a margin of {int}', (world: WmWorld, gap: number, margin: number) => {
  wm(world).options.layouts = createDefaultLayouts({ gap, margin });
});

Given('the window manager offers no layouts', (world: WmWorld) => {
  wm(world).options.layouts = createLayoutRegistry();
});

Given('the window manager starts in the layout {string}', (world: WmWorld, id: string) => {
  wm(world).options.layout = id;
});

Given('new windows are {int} by {int}', (world: WmWorld, w: number, h: number) => {
  wm(world).options.windowSize = { w, h };
});

Given('windows may be as small as {int} by {int}', (world: WmWorld, w: number, h: number) => {
  wm(world).options.minSize = { w, h };
});

Given('the compact width is {int}', (world: WmWorld, width: number) => {
  wm(world).options.compactWidth = width;
});

Given('the desktop clock reads {int}', (world: WmWorld, at: number) => {
  wm(world).clock = at;
});

Given('a window manager on a desktop of {int} by {int}', (world: WmWorld, w: number, h: number) => {
  const scratch = wm(world);
  scratch.registry = scratch.options.layouts ?? createDefaultLayouts();
  watch(
    world,
    createWindowManager({
      ...scratch.options,
      layouts: scratch.registry,
      area: { x: 0, y: 0, w, h },
      now: () => scratch.clock,
      onLayout: (id) => void scratch.remembered.push(id),
    }),
  );
});

Given('a window manager with every default', (world: WmWorld) => {
  watch(world, createWindowManager());
});

Then('creating the window manager fails with {string}', (world: WmWorld, reason: string) => {
  attempt(world, () => createWindowManager(wm(world).options));
  expect(refusal(world)).toBe(reason);
});

When(/^the windows? "([^"]*)" opens?$/, (world: WmWorld, list: string) => {
  for (const id of names(list)) manager(world).open(id);
});

When('the person focuses {string}', (world: WmWorld, id: string) => {
  manager(world).focus(id);
});

When('the person minimises {string}', (world: WmWorld, id: string) => {
  manager(world).minimise(id);
});

When('the person closes {string}', (world: WmWorld, id: string) => {
  manager(world).close(id);
});

When('the person turns to the shell', (world: WmWorld) => {
  manager(world).blur();
});

When('the applet in {string} is stopped', (world: WmWorld, id: string) => {
  manager(world).stop(id);
});

When('the person moves {string} to {int},{int} sized {int} by {int}', (world: WmWorld, id: string, x: number, y: number, w: number, h: number) => {
  manager(world).move(id, { x, y, w, h });
});

When('the person picks the layout {string}', (world: WmWorld, id: string) => {
  manager(world).setLayout(id);
});

When('the person tries to pick the layout {string}', (world: WmWorld, id: string) => {
  attempt(world, () => manager(world).setLayout(id));
});

When("the window manager's registry gains the layout {string}", (world: WmWorld, id: string) => {
  registry(world).register({ id, label: id, strategy: rowsLayout });
});

When('the desktop becomes {int} by {int}', (world: WmWorld, w: number, h: number) => {
  manager(world).setArea({ x: 0, y: 0, w, h });
});

When(/^the page is (hidden|shown)$/, (world: WmWorld, how: string) => {
  manager(world).setPageVisible(how === 'shown');
});

When('{string} is attached', (world: WmWorld, id: string) => {
  const reports = wm(world).reports.get(id) ?? [];
  wm(world).reports.set(id, reports);
  manager(world).attach(id, { setVisibility: (visibility) => void reports.push(visibility) });
});

When('the window manager is destroyed', (world: WmWorld) => {
  manager(world).destroy();
});

function expectWindows(world: WmWorld, table: DataTable, ids?: readonly string[]): void {
  const columns = table.raw()[0] ?? [];
  const cells: Record<string, (window: WindowManagerState['windows'][number]) => string> = {
    id: (window) => window.id,
    x: (window) => String(window.rect.x),
    y: (window) => String(window.rect.y),
    w: (window) => String(window.rect.w),
    h: (window) => String(window.rect.h),
    focused: (window) => yes(window.focused),
    minimised: (window) => yes(window.minimised),
    stopped: (window) => yes(window.stopped),
  };
  const shown = state(world).windows.filter((window) => !ids || ids.includes(window.id));
  expect(shown.map((window) => Object.fromEntries(columns.map((column) => [column, cells[column]?.(window)])))).toEqual(table.hashes());
}

Then('the windows are:', (world: WmWorld, table: DataTable) => {
  expectWindows(world, table);
});

Then('the windows include:', (world: WmWorld, table: DataTable) => {
  expectWindows(world, table, table.hashes().map((row) => row.id ?? ''));
});

Then('there are no windows', (world: WmWorld) => {
  expect(state(world).windows).toEqual([]);
});

Then('the front-to-back order is {string}', (world: WmWorld, order: string) => {
  const front = [...state(world).windows].sort((a, b) => b.z - a.z).map((window) => window.id);
  expect(front).toEqual(names(order));
});

Then('{string} is focused', (world: WmWorld, id: string) => {
  expect(state(world).focusedId).toBe(id);
  expect(state(world).windows.filter((window) => window.focused).map((window) => window.id)).toEqual([id]);
});

Then('nothing on the desktop is focused', (world: WmWorld) => {
  expect(state(world).focusedId).toBeNull();
});

Then('the layout is {string} labelled {string}', (world: WmWorld, id: string, label: string) => {
  expect(state(world).layout).toEqual({ id, label });
});

Then('the layouts on offer are {string}', (world: WmWorld, list: string) => {
  expect(manager(world).layouts().map((layout) => layout.id)).toEqual(names(list));
});

Then('the remembered layout is {string}', (world: WmWorld, id: string) => {
  expect(wm(world).remembered).toEqual([id]);
});

Then('nothing was remembered', (world: WmWorld) => {
  expect(wm(world).remembered).toEqual([]);
});

Then(/^the windows (can|cannot) be moved$/, (world: WmWorld, how: string) => {
  expect(state(world).freeform).toBe(how === 'can');
});

Then(/^the desktop is (compact|not compact)$/, (world: WmWorld, how: string) => {
  expect(state(world).compact).toBe(how === 'compact');
});

Then('the window manager refuses with {string}', (world: WmWorld, reason: string) => {
  expect(refusal(world)).toBe(reason);
});

Then('the guard is told {string} is visible and focused for {int} ms', (world: WmWorld, id: string, ms: number) => {
  expect(manager(world).visibilityOf(id)).toEqual({ visible: true, focused: true, msSinceFocusGain: ms });
});

Then('the guard is told {string} is visible and focused just now', (world: WmWorld, id: string) => {
  const told = manager(world).visibilityOf(id);
  expect(told).toMatchObject({ visible: true, focused: true });
  expect(told.msSinceFocusGain).toBeGreaterThanOrEqual(0);
  expect(told.msSinceFocusGain).toBeLessThan(5000);
});

Then('the guard is told {string} is visible and not focused', (world: WmWorld, id: string) => {
  expect(manager(world).visibilityOf(id)).toEqual({ visible: true, focused: false });
});

Then('the guard is told {string} is hidden', (world: WmWorld, id: string) => {
  expect(manager(world).visibilityOf(id)).toEqual({ visible: false, focused: false });
});

Then('the reports to {string} are:', (world: WmWorld, id: string, table: DataTable) => {
  const told = (wm(world).reports.get(id) ?? []).map((report) => ({
    visible: yes(report.visible),
    focused: yes(report.focused),
    ms: report.msSinceFocusGain === undefined ? '' : String(report.msSinceFocusGain),
  }));
  expect(told).toEqual(table.hashes());
});

Then(/^"([^"]*)" got (\d+) reports?$/, (world: WmWorld, id: string, count: string) => {
  expect(wm(world).reports.get(id) ?? []).toHaveLength(Number(count));
});

Then(/^the state was published (\d+) times?$/, (world: WmWorld, count: string) => {
  expect(wm(world).published).toBe(Number(count));
});

Then('the state stream has ended', (world: WmWorld) => {
  expect(wm(world).ended).toBe(true);
});
