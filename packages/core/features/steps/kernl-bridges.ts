import { expect } from 'vitest';
import { Given, Then } from 'quickpickle';
import { boot, k } from './kernl.js';
import { fakeTorrentBackend } from './services.js';
import { scratch, type CoreWorld } from './world.js';

Given('a kernl shell over that host and pool with a torrent backend', (world: CoreWorld) => {
  const asked: string[] = [];
  scratch(world).torrentAsked = asked;
  boot(world, { torrent: fakeTorrentBackend(asked) });
});

Then('the shell bridge for {string} downloads inside kernl', (world: CoreWorld, scheme: string) => {
  expect(k(world).kernl.bridges.forScheme(scheme)?.availability()).toEqual({ available: true });
});

Then('the host was asked to open nothing', (world: CoreWorld) => {
  expect(k(world).record.links).toEqual([]);
});
