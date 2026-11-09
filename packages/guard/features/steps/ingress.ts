import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createGuardConfig, createIngressGuard, type GuardEnvelope, type GuardProfile } from '@kernlize/guard';
import { last, scratch, type GuardWorld } from './world.js';

const NAPPLET = 'chat';

function ingress(world: GuardWorld) {
  const { ingress } = scratch(world);
  if (!ingress) throw new Error('create an ingress guard first');
  return ingress;
}

function admit(world: GuardWorld, windowId: string, envelope: GuardEnvelope, times = 1, hold = true): void {
  const state = scratch(world);
  for (let i = 0; i < times; i += 1) {
    state.dispositions.push(ingress(world).admit(windowId, NAPPLET, envelope, state.visibility, { hold }));
  }
}

Given('a guard ingress guard using the {string} profile with a drain batch of {int}', (world: GuardWorld, profile: GuardProfile, drainBatch: number) => {
  const state = scratch(world);
  state.ingress = createIngressGuard({
    config: createGuardConfig(profile),
    now: () => state.clock,
    onEvent: (event) => state.events.push(event),
    drainBatch,
  });
});

Given('a guard ingress guard using the {string} profile with an injected clock only', (world: GuardWorld, profile: GuardProfile) => {
  const state = scratch(world);
  state.ingress = createIngressGuard({ config: createGuardConfig(profile), now: () => state.clock });
});

Given('a guard ingress guard using the {string} profile with default options', (world: GuardWorld, profile: GuardProfile) => {
  scratch(world).ingress = createIngressGuard({ config: createGuardConfig(profile) });
});

When('the guard clock advances by {int} ms', (world: GuardWorld, ms: number) => {
  scratch(world).clock += ms;
});

When('the guard clock rewinds by {int} ms', (world: GuardWorld, ms: number) => {
  scratch(world).clock -= ms;
});

Given('guard window {string} is hidden', (world: GuardWorld, _windowId: string) => {
  scratch(world).visibility = { visible: false, focused: false };
});

Given('guard window {string} is visible', (world: GuardWorld, _windowId: string) => {
  scratch(world).visibility = { visible: true, focused: true };
});

When('the guard admits {int} {string} envelopes from window {string}', (world: GuardWorld, count: number, type: string, windowId: string) => {
  admit(world, windowId, { type }, count);
});

When('the guard admits {int} {string} envelopes from window {string} without holding any', (world: GuardWorld, count: number, type: string, windowId: string) => {
  admit(world, windowId, { type }, count, false);
});

When('the guard admits a {string} envelope from window {string}', (world: GuardWorld, type: string, windowId: string) => {
  admit(world, windowId, { type });
});

When('the guard admits a {string} envelope of {int} bytes from window {string}', (world: GuardWorld, type: string, size: number, windowId: string) => {
  admit(world, windowId, { type, size });
});

When('the guard drains window {string}', (world: GuardWorld, windowId: string) => {
  scratch(world).drained = ingress(world).drain(windowId);
});

When('the guard releases window {string}', (world: GuardWorld, windowId: string) => {
  ingress(world).release(windowId);
});

When('the guard forgets window {string}', (world: GuardWorld, windowId: string) => {
  ingress(world).forget(windowId);
});

Then('the guard\'s last disposition is {string}', (world: GuardWorld, disposition: string) => {
  expect(last(scratch(world).dispositions)).toBe(disposition);
});

Then('every guard disposition so far is {string}', (world: GuardWorld, disposition: string) => {
  const { dispositions } = scratch(world);
  expect(dispositions.length).toBeGreaterThan(0);
  expect(new Set(dispositions)).toEqual(new Set([disposition]));
});

Then('guard window {string} is quarantined', (world: GuardWorld, windowId: string) => {
  expect(ingress(world).isQuarantined(windowId)).toBe(true);
});

Then('guard window {string} is not quarantined', (world: GuardWorld, windowId: string) => {
  expect(ingress(world).isQuarantined(windowId)).toBe(false);
});
