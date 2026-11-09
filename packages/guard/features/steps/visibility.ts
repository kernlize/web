import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createGuardConfig, createVisibilityGate, type GuardProfile, type OpClass, type WindowVisibility } from '@kernlize/guard';
import { scratch, type GuardWorld } from './world.js';

const STATES: Readonly<Record<string, WindowVisibility>> = {
  hidden: { visible: false, focused: false },
  visible: { visible: true, focused: false },
  focused: { visible: true, focused: true },
};

function gate(world: GuardWorld) {
  const { gate } = scratch(world);
  if (!gate) throw new Error('create a visibility gate first');
  return gate;
}

function state(name: string): WindowVisibility {
  const found = STATES[name];
  if (!found) throw new Error(`unknown visibility ${name}`);
  return found;
}

Given('a guard visibility gate using the {string} profile', (world: GuardWorld, profile: GuardProfile) => {
  const s = scratch(world);
  s.gate = createVisibilityGate({
    config: createGuardConfig(profile),
    now: () => s.clock,
    onEvent: (event) => s.events.push(event),
    nappletFor: () => 'chat',
  });
});

Given('a guard visibility gate using the {string} profile without a resolver', (world: GuardWorld, profile: GuardProfile) => {
  const s = scratch(world);
  s.gate = createVisibilityGate({ config: createGuardConfig(profile), now: () => s.clock, onEvent: (event) => s.events.push(event) });
});

When('the guard gate marks window {string} as {string}', (world: GuardWorld, windowId: string, name: string) => {
  gate(world).setVisibility(windowId, state(name));
});

Then('the guard gate reports window {string} as visible {string} and focused {string}', (world: GuardWorld, windowId: string, visible: string, focused: string) => {
  expect(gate(world).getVisibility(windowId)).toEqual({ visible: visible === 'true', focused: focused === 'true' });
});

Then('the guard gate defers {string} for window {string}', (world: GuardWorld, opClass: OpClass, windowId: string) => {
  expect(gate(world).shouldDefer(windowId, opClass)).toBe(true);
});

Then('the guard gate does not defer {string} for window {string}', (world: GuardWorld, opClass: OpClass, windowId: string) => {
  expect(gate(world).shouldDefer(windowId, opClass)).toBe(false);
});

When('the guard gate defers a {string} envelope for window {string}', (world: GuardWorld, type: string, windowId: string) => {
  scratch(world).deferred = gate(world).defer(windowId, { type });
});

When('the guard gate defers {int} {string} envelopes for window {string}', (world: GuardWorld, count: number, type: string, windowId: string) => {
  for (let i = 0; i < count; i += 1) scratch(world).deferred = gate(world).defer(windowId, { type });
});

Then('the guard gate accepted the deferral', (world: GuardWorld) => {
  expect(scratch(world).deferred).toBe(true);
});

Then('the guard gate refused the deferral', (world: GuardWorld) => {
  expect(scratch(world).deferred).toBe(false);
});

When('the guard gate drains window {string}', (world: GuardWorld, windowId: string) => {
  scratch(world).drained = gate(world).drain(windowId);
});

When('the guard gate forgets window {string}', (world: GuardWorld, windowId: string) => {
  gate(world).forget(windowId);
});

Given('a guard visibility gate using the {string} profile with default options', (world: GuardWorld, profile: GuardProfile) => {
  scratch(world).gate = createVisibilityGate({ config: createGuardConfig(profile) });
});
