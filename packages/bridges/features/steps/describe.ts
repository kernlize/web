import { expect } from 'vitest';
import { DataTable, Then } from 'quickpickle';
import { describeBridge, type Bridge } from '@kernlize/bridges';
import type { BridgeWorld } from './world';

const PROTOCOL_WORDS = /torrent|magnet|nzb|usenet|soulseek|slsk|http|mailto|smtp|imap/i;

function expectRows(bridge: Bridge | undefined, table: DataTable): void {
  expect(bridge).toBeDefined();
  if (bridge) expect(describeBridge(bridge)).toEqual(table.hashes());
}

Then('describing the web bridge gives', (world: BridgeWorld, table: DataTable) => {
  expectRows(world.webBridge, table);
});

Then('describing the bridge gives', (world: BridgeWorld, table: DataTable) => {
  expectRows(world.bridge, table);
});

Then('no description label names a protocol', (world: BridgeWorld) => {
  expect(world.bridge).toBeDefined();
  if (world.bridge) {
    for (const row of describeBridge(world.bridge)) {
      expect(row.label).not.toMatch(PROTOCOL_WORDS);
      expect(row.value).not.toMatch(PROTOCOL_WORDS);
    }
  }
});
