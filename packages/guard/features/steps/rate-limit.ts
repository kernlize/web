import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import {
  createFocusRateLimiter,
  createGuardConfig,
  type GuardConfig,
  type GuardEnvelope,
  type OpClass,
  type GuardProfile,
  type WindowVisibility,
} from '@kernlize/guard';
import { scratch, type GuardWorld } from './world.js';

const FOCUS: Readonly<Record<string, WindowVisibility>> = {
  focused: { visible: true, focused: true },
  unfocused: { visible: true, focused: false },
};

function limiter(world: GuardWorld) {
  const { limiter } = scratch(world);
  if (!limiter) throw new Error('create a focus rate limiter first');
  return limiter;
}

function install(world: GuardWorld, config: GuardConfig): void {
  const s = scratch(world);
  s.limiter = createFocusRateLimiter({ config, now: () => s.clock, onEvent: (event) => s.events.push(event) });
}

function observe(world: GuardWorld, params: { windowId: string; napplet: string; envelope: GuardEnvelope; visibility: WindowVisibility; times: number }): void {
  for (let i = 0; i < params.times; i += 1) {
    scratch(world).result = limiter(world).observe(params.windowId, params.napplet, params.envelope, params.visibility);
  }
}

function focus(name: string): WindowVisibility {
  const found = FOCUS[name];
  if (!found) throw new Error(`unknown focus ${name}`);
  return found;
}

Given('a guard rate limiter using the {string} profile', (world: GuardWorld, profile: GuardProfile) => {
  install(world, createGuardConfig(profile));
});

Given('a guard rate limiter using the {string} profile with default options', (world: GuardWorld, profile: GuardProfile) => {
  scratch(world).limiter = createFocusRateLimiter({ config: createGuardConfig(profile) });
});

Given('a guard rate limiter whose {string} budget only flags past {int}', (world: GuardWorld, opClass: OpClass, capacity: number) => {
  const config = createGuardConfig('strict');
  const budget = { ...config.rateLimits[opClass], capacity, action: 'flag' as const };
  install(world, { ...config, rateLimits: { ...config.rateLimits, [opClass]: budget } });
});

Given('a guard rate limiter whose {string} budget is ignored past {int}', (world: GuardWorld, opClass: OpClass, capacity: number) => {
  const config = createGuardConfig('strict');
  const budget = { ...config.rateLimits[opClass], capacity, action: 'ignore' as const };
  install(world, { ...config, rateLimits: { ...config.rateLimits, [opClass]: budget } });
});

When(
  'the guard rate limiter observes {int} {string} envelopes from applet {string} in window {string} while {string}',
  (world: GuardWorld, times: number, type: string, napplet: string, windowId: string, focusName: string) => {
    observe(world, { windowId, napplet, envelope: { type }, visibility: focus(focusName), times });
  },
);

When(
  'the guard rate limiter observes {int} {string} envelopes of kind {int} from applet {string} in window {string} while {string}',
  (world: GuardWorld, times: number, type: string, kind: number, napplet: string, windowId: string, focusName: string) => {
    observe(world, { windowId, napplet, envelope: { type, kind }, visibility: focus(focusName), times });
  },
);

When(
  'the guard rate limiter observes a {string} envelope of {int} bytes from applet {string} in window {string} focused for {int} ms',
  (world: GuardWorld, type: string, size: number, napplet: string, windowId: string, msSinceFocusGain: number) => {
    const visibility: WindowVisibility = { visible: true, focused: true, msSinceFocusGain };
    observe(world, { windowId, napplet, envelope: { type, kind: 1, size }, visibility, times: 1 });
  },
);

When('the guard rate limiter forgets window {string}', (world: GuardWorld, windowId: string) => {
  limiter(world).forget(windowId);
});

Then('the guard rate limiter decided {string}', (world: GuardWorld, decision: string) => {
  expect(scratch(world).result?.decision).toBe(decision);
});

Then('the guard rate limiter gave reason {string} with action {string}', (world: GuardWorld, reason: string, action: string) => {
  expect(scratch(world).result?.reason).toBe(reason);
  expect(scratch(world).result?.action).toBe(action);
});
