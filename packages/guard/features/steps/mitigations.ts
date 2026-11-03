import { expect } from 'vitest';
import { Then, When, type DataTable } from 'quickpickle';
import { createGuardConfig, describeMitigations, type GuardProfile } from '@kernl/guard';
import { scratch, type GuardWorld } from './world.js';

const PROTOCOL_WORDS = /nostr|nip|relay|napplet|pubkey|npub/i;

function mitigations(world: GuardWorld) {
  const { mitigations } = scratch(world);
  if (!mitigations) throw new Error('describe the mitigations first');
  return mitigations;
}

function mitigation(world: GuardWorld, id: string) {
  const found = mitigations(world).find((entry) => entry.id === id);
  if (!found) throw new Error(`no mitigation ${id}`);
  return found;
}

When('the guard describes the mitigations for the {string} profile', (world: GuardWorld, profile: GuardProfile) => {
  scratch(world).mitigations = describeMitigations(createGuardConfig(profile));
});

Then('the guard describes {int} mitigations', (world: GuardWorld, count: number) => {
  expect(mitigations(world)).toHaveLength(count);
});

Then('every guard mitigation is enabled', (world: GuardWorld) => {
  expect(mitigations(world).every((entry) => entry.enabled)).toBe(true);
});

Then('the guard mitigations are listed in this order:', (world: GuardWorld, table: DataTable) => {
  const listed = mitigations(world).map(({ id, provider }) => ({ id, provider }));
  expect(listed).toEqual(table.hashes());
});

Then('no guard mitigation names a protocol', (world: GuardWorld) => {
  for (const entry of mitigations(world)) {
    expect(`${entry.title} ${entry.summary} ${entry.limit ?? ''}`).not.toMatch(PROTOCOL_WORDS);
  }
});

Then('the guard mitigation {string} has limit {string}', (world: GuardWorld, id: string, limit: string) => {
  expect(mitigation(world, id).limit).toBe(limit);
});

Then('the guard mitigation {string} has no limit', (world: GuardWorld, id: string) => {
  expect(mitigation(world, id).limit).toBeUndefined();
});

Then('the guard mitigations {string} never claim to hold, queue, block or refuse', (world: GuardWorld, ids: string) => {
  for (const id of ids.split(',')) {
    const { title, summary } = mitigation(world, id);
    expect(`${title} ${summary}`).not.toMatch(/\b(held until|are held|queued|blocked|refused until|are refused|wait their turn|paused)\b/i);
  }
});

Then('the guard mitigation {string} is titled {string}', (world: GuardWorld, id: string, title: string) => {
  expect(mitigation(world, id).title).toBe(title);
});

Then('the guard mitigation {string} says {string}', (world: GuardWorld, id: string, summary: string) => {
  expect(mitigation(world, id).summary).toBe(summary);
});
