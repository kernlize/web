import { expect } from 'vitest';
import { Given, Then } from 'quickpickle';
import {
  createHandoffBackends,
  createMailBridge,
  createNzbBridge,
  createSoulseekBridge,
  createTorrentBridge,
  type Bridge,
  type HandoffBackends,
} from '@kernl/bridges';
import type { BridgeWorld } from './world';

const BRIDGES: Record<string, (backends: HandoffBackends) => Bridge> = {
  torrent: (backends) => createTorrentBridge(backends.torrent),
  nzb: (backends) => createNzbBridge(backends.nzb),
  soulseek: (backends) => createSoulseekBridge(backends.soulseek),
  mail: (backends) => createMailBridge(backends.mail),
};

function handOff(world: BridgeWorld, kind: string, waits: boolean): void {
  const make = BRIDGES[kind];
  if (!make) throw new Error(`unknown bridge kind ${kind}`);
  const opened: string[] = [];
  world.opened = opened;
  world.bridge = make(
    createHandoffBackends((uri) => {
      opened.push(uri);
      return waits ? Promise.resolve() : undefined;
    }),
  );
}

Given('the {word} bridge with hand-off backends', (world: BridgeWorld, kind: string) => handOff(world, kind, false));

Given('the {word} bridge with hand-off backends whose opener waits', (world: BridgeWorld, kind: string) =>
  handOff(world, kind, true),
);

Then('the bridge is available by handing off to the device', (world: BridgeWorld) => {
  expect(world.bridge?.availability()).toEqual({ available: true, handoff: true });
});

Then('the device was asked to open {string} once', (world: BridgeWorld, uri: string) => {
  expect(world.opened).toEqual([uri]);
});

Then('the device was not asked to open anything', (world: BridgeWorld) => {
  expect(world.opened).toEqual([]);
});
