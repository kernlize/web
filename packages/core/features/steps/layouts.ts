import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import type { LayoutStrategy, Rect, WindowPlacement, WindowState } from '@kehto/wm';
import { createColumnsLayout, createDwindleLayout, createMasterStackLayout, floatingLayout } from '@kernlize/core';
import { scratch, type CoreWorld } from './world.js';

function windows(world: CoreWorld): WindowState[] {
  return scratch(world).windows as WindowState[];
}

function arrange(world: CoreWorld, layout: LayoutStrategy): void {
  scratch(world).placements = layout.arrange(windows(world), scratch(world).container as Rect);
}

Given('a container of {int} by {int} at {int},{int}', (world: CoreWorld, w: number, h: number, x: number, y: number) => {
  scratch(world).container = { x, y, w, h };
});

Given('windows:', (world: CoreWorld, table: DataTable) => {
  scratch(world).windows = table.hashes().map((row) => ({
    id: row.id as string,
    focused: row.focused === 'true',
    minimized: row.minimized === 'true',
    rect: { x: Number(row.x), y: Number(row.y), w: Number(row.w), h: Number(row.h) },
  }));
});

Given('only window {string} is shown', (world: CoreWorld, id: string) => {
  scratch(world).windows = windows(world).filter((window) => window.id === id);
});

Given('no window is shown', (world: CoreWorld) => {
  scratch(world).windows = [];
});

Given('no window is focused', (world: CoreWorld) => {
  scratch(world).windows = windows(world).map((window) => ({ ...window, focused: false }));
});

When('the shell arranges with the floating layout', (world: CoreWorld) => {
  arrange(world, floatingLayout);
});

When('the shell arranges with the dwindle layout and a gap of {int}', (world: CoreWorld, gap: number) => {
  arrange(world, createDwindleLayout({ gap }));
});

When('the shell arranges with the dwindle layout, a gap of {int} and a margin of {int}', (world: CoreWorld, gap: number, margin: number) => {
  arrange(world, createDwindleLayout({ gap, margin }));
});

When('the shell arranges with the columns layout using defaults', (world: CoreWorld) => {
  arrange(world, createColumnsLayout());
});

When('the shell arranges with the dwindle layout using defaults', (world: CoreWorld) => {
  arrange(world, createDwindleLayout());
});

When('the shell arranges with the columns layout and a gap of {int}', (world: CoreWorld, gap: number) => {
  arrange(world, createColumnsLayout({ gap }));
});

When('the shell arranges with the master-stack layout at ratio {float} and a gap of {int}', (world: CoreWorld, ratio: number, gap: number) => {
  arrange(world, createMasterStackLayout({ ratio, gap }));
});

When('the shell arranges with the master-stack layout using defaults', (world: CoreWorld) => {
  arrange(world, createMasterStackLayout());
});

Then('the placements are:', (world: CoreWorld, table: DataTable) => {
  const expected: WindowPlacement[] = table.hashes().map((row) => ({
    id: row.id as string,
    rect: { x: Number(row.x), y: Number(row.y), w: Number(row.w), h: Number(row.h) },
  }));
  expect(scratch(world).placements).toEqual(expected);
});

Then('there are no placements', (world: CoreWorld) => {
  expect(scratch(world).placements).toEqual([]);
});
