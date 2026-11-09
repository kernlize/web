import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { setGlobalRate, setPolicy, type NappletPolicy } from '@kehto/firewall';
import {
  createFocusFirewall,
  createGuardConfig,
  type GuardConfig,
  type GuardEnvelope,
  type GuardProfile,
  type WindowVisibility,
} from '@kernlize/guard';
import { scratch, type GuardWorld } from './world.js';

const FOCUS: Readonly<Record<string, WindowVisibility>> = {
  focused: { visible: true, focused: true },
  unfocused: { visible: true, focused: false },
};

function firewall(world: GuardWorld) {
  const { firewall } = scratch(world);
  if (!firewall) throw new Error('create a focus firewall first');
  return firewall;
}

function install(world: GuardWorld, config: GuardConfig): void {
  const s = scratch(world);
  s.firewall = createFocusFirewall({ config, now: () => s.clock, onEvent: (event) => s.events.push(event) });
}

function observe(world: GuardWorld, params: { windowId: string; napplet: string; envelope: GuardEnvelope; visibility: WindowVisibility; times: number }): void {
  for (let i = 0; i < params.times; i += 1) {
    scratch(world).result = firewall(world).observe(params.windowId, params.napplet, params.envelope, params.visibility);
  }
}

function focus(name: string): WindowVisibility {
  const found = FOCUS[name];
  if (!found) throw new Error(`unknown focus ${name}`);
  return found;
}

Given('a guard focus firewall using the {string} profile', (world: GuardWorld, profile: GuardProfile) => {
  install(world, createGuardConfig(profile));
});

Given('a guard focus firewall using the {string} profile with default options', (world: GuardWorld, profile: GuardProfile) => {
  scratch(world).firewall = createFocusFirewall({ config: createGuardConfig(profile) });
});

Given(
  'a guard focus firewall using the {string} profile where applet {string} has the {string} policy',
  (world: GuardWorld, profile: GuardProfile, napplet: string, policy: NappletPolicy) => {
    const config = createGuardConfig(profile);
    install(world, { ...config, firewall: setPolicy(config.firewall, napplet, policy) });
  },
);

Given('a guard focus firewall whose applet {string} has a flag-only budget of {int}', (world: GuardWorld, napplet: string, capacity: number) => {
  const config = createGuardConfig('strict');
  const limit = { capacity, windowMs: 60_000, action: 'flag' as const };
  install(world, { ...config, firewall: setGlobalRate(config.firewall, napplet, limit) });
});

When(
  'the guard firewall observes {int} {string} envelopes from applet {string} in window {string} while {string}',
  (world: GuardWorld, times: number, type: string, napplet: string, windowId: string, focusName: string) => {
    observe(world, { windowId, napplet, envelope: { type }, visibility: focus(focusName), times });
  },
);

When(
  'the guard firewall observes {int} {string} envelopes of kind {int} from applet {string} in window {string} while {string}',
  (world: GuardWorld, times: number, type: string, kind: number, napplet: string, windowId: string, focusName: string) => {
    observe(world, { windowId, napplet, envelope: { type, kind }, visibility: focus(focusName), times });
  },
);

When(
  'the guard firewall observes a {string} envelope of {int} bytes from applet {string} in window {string} focused for {int} ms',
  (world: GuardWorld, type: string, size: number, napplet: string, windowId: string, msSinceFocusGain: number) => {
    const visibility: WindowVisibility = { visible: true, focused: true, msSinceFocusGain };
    observe(world, { windowId, napplet, envelope: { type, kind: 1, size }, visibility, times: 1 });
  },
);

When('the guard firewall forgets window {string}', (world: GuardWorld, windowId: string) => {
  firewall(world).forget(windowId);
});

Then('the guard firewall decided {string}', (world: GuardWorld, decision: string) => {
  expect(scratch(world).result?.decision).toBe(decision);
});

Then('the guard firewall\'s decision has rule {string}', (world: GuardWorld, ruleId: string) => {
  expect(scratch(world).result?.ruleId).toBe(ruleId);
});
