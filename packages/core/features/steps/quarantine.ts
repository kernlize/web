import { expect, vi } from 'vitest';
import { Then, When } from 'quickpickle';
import { k, settle } from './kernl.js';
import { scratch, type CoreWorld } from './world.js';

/** More than the strict profile's quarantine threshold, so the loop always ends in quarantine. */
const MAX_MESSAGES = 400;

function answered(world: CoreWorld, id: string): boolean {
  return k(world).received.some((entry) => entry.id === id);
}

When('the applet sends {string} one message at a time until the guard quarantines it', async (world: CoreWorld, type: string) => {
  const state = k(world);
  const port = state.channel?.port1;
  if (!port) throw new Error('hello first');
  const sent: string[] = [];
  for (let i = 0; i < MAX_MESSAGES && state.record.revoked.length === 0; i += 1) {
    const id = `step-${i}`;
    sent.push(id);
    port.postMessage({ type, id, key: 'k' });
    await vi.waitFor(() => expect(answered(world, id) || state.record.revoked.length > 0).toBe(true), { interval: 1 });
  }
  await settle();
  scratch(world).sent = sent;
});

function sentIds(world: CoreWorld): string[] {
  return (scratch(world).sent as string[] | undefined) ?? [];
}

Then('the message that crossed the limit was never answered', (world: CoreWorld) => {
  const trigger = sentIds(world).at(-1) ?? '';
  expect(k(world).record.revoked).toHaveLength(1);
  expect(answered(world, trigger)).toBe(false);
});

Then('every message before it was answered', (world: CoreWorld) => {
  const before = sentIds(world).slice(0, -1);
  expect(before.length).toBeGreaterThan(0);
  expect(before.filter((id) => !answered(world, id))).toEqual([]);
});
