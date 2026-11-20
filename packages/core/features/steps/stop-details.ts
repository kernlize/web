import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import { k, settle, windowMessage } from './kernl.js';
import type { CoreWorld } from './world.js';

// What the host is told about a stop beyond its reason: kehto's detail and the guard limit crossed.

Then('the host was told kehto\'s detail {string}', (world: CoreWorld, detail: string) => {
  expect(k(world).record.stops.map((stop) => stop?.detail)).toEqual([detail]);
});

Then('the host was told it crossed the {string} limit of {int} per {int} ms under {string}', (world: CoreWorld, cause: string, count: number, windowMs: number, profile: string) => {
  expect(k(world).record.stops.map((stop) => stop?.limit)).toEqual([{ cause, count, windowMs, profile }]);
});

Then('the host was told it crossed the {string} limit of {int} under {string}', (world: CoreWorld, cause: string, count: number, profile: string) => {
  expect(k(world).record.stops.map((stop) => stop?.limit)).toEqual([{ cause, count, profile }]);
});

Then('the host was told no limit', (world: CoreWorld) => {
  expect(k(world).record.stops.map((stop) => stop?.limit)).toEqual([undefined]);
});

When('the applet posts a {string} message on the window', async (world: CoreWorld, type: string) => {
  const win = k(world).frame?.contentWindow;
  if (!win) throw new Error('mount first');
  k(world).kernl.handleWindowMessage(windowMessage(win, { type }, []));
  await settle();
});
