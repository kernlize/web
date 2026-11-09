import { expect } from 'vitest';
import { Given, Then, type DataTable } from 'quickpickle';
import { parseHex, readPalette, type Palette, type Rgb } from '../../src/motion/palette.ts';
import { changesPage, isSitePage } from '../../src/motion/routes.ts';

interface MotionWorld {
  themeTokens?: Map<string, string>;
}

const channels = (rgb: Rgb): string => rgb.map((channel) => Number(channel.toFixed(3))).join(', ');

Then('the path {string} under the base {string} is a site page', (_world: MotionWorld, path: string, base: string) => {
  expect(isSitePage(path, base)).toBe(true);
});

Then('the path {string} under the base {string} is not a site page', (_world: MotionWorld, path: string, base: string) => {
  expect(isSitePage(path, base)).toBe(false);
});

Then('moving from {string} to {string} changes the page', (_world: MotionWorld, from: string, to: string) => {
  expect(changesPage(new URL(from), new URL(to))).toBe(true);
});

Then('moving from {string} to {string} does not change the page', (_world: MotionWorld, from: string, to: string) => {
  expect(changesPage(new URL(from), new URL(to))).toBe(false);
});

Then('the stage reads the colour {string} as {string}', (_world: MotionWorld, colour: string, expected: string) => {
  expect(channels(parseHex(colour))).toBe(expected);
});

Given('the theme tokens:', (world: MotionWorld, table: DataTable) => {
  world.themeTokens = new Map(table.hashes().map((row) => [row.token ?? '', row.value ?? '']));
});

Then('the stage palette is:', (world: MotionWorld, table: DataTable) => {
  const palette = readPalette((token) => world.themeTokens?.get(token) ?? '');
  const read = Object.fromEntries(Object.entries(palette).map(([role, rgb]) => [role, channels(rgb as Palette[keyof Palette])]));
  expect(read).toEqual(Object.fromEntries(table.hashes().map((row) => [row.role, row.channels])));
});
