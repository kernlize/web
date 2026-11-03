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
