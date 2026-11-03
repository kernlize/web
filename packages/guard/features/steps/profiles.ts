import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import { setPolicy } from '@kehto/firewall';
import { applyNappletRules, createGuardConfig, GUARD_PROFILES, type GuardLimits, type GuardProfile, type OpClass } from '@kernl/guard';
import { scratch, splitList, type GuardWorld } from './world.js';

function config(world: GuardWorld) {
  const { config } = scratch(world);
  if (!config) throw new Error('build a profile first');
  return config;
}

Then('the guard profiles are {string}', (_world: GuardWorld, list: string) => {
  expect([...GUARD_PROFILES]).toEqual(splitList(list));
});

When('the guard builds the {string} profile', (world: GuardWorld, profile: GuardProfile) => {
  const built = createGuardConfig(profile);
  scratch(world).config = built;
  scratch(world).original = built.firewall;
  expect(built.profile).toBe(profile);
});

Then('the guard limit {string} is {float}', (world: GuardWorld, name: keyof GuardLimits, value: number) => {
  expect(config(world).limits[name]).toBe(value);
});

Then('the guard rate {string} is {int} per {int} ms', (world: GuardWorld, opClass: OpClass, capacity: number, windowMs: number) => {
  expect(config(world).limits.rates[opClass]).toEqual({ capacity, windowMs });
});

Then(
  'the guard firewall default rate is {int} per {int} ms with action {string}',
  (world: GuardWorld, capacity: number, windowMs: number, action: string) => {
    expect(config(world).firewall.defaultRate).toEqual({ capacity, windowMs, action });
  },
);

Then(
  'the guard firewall burst guard allows {int} ops in {int} ms with action {string}',
  (world: GuardWorld, maxOps: number, windowMs: number, action: string) => {
    expect(config(world).firewall.burstGuard).toEqual({ maxOps, windowMs, action });
  },
);

Then('the guard firewall unfocused multiplier is {float}', (world: GuardWorld, value: number) => {
  expect(config(world).firewall.unfocusedMultiplier).toBe(value);
});

Then('the guard firewall has {int} matchers', (world: GuardWorld, count: number) => {
  expect(config(world).firewall.matchers).toHaveLength(count);
});

Then(
  'the guard firewall has matcher {string} for class {string} blocking from {int} bytes',
  (world: GuardWorld, id: string, opClass: string, minSize: number) => {
    expect(config(world).firewall.matchers).toContainEqual({ id, opClass, minSize, action: 'block' });
  },
);

Then('the guard firewall has no applet rules', (world: GuardWorld) => {
  expect(config(world).firewall.napplets).toEqual({});
});

Then('the guard firewall has rules for {int} applet', (world: GuardWorld, count: number) => {
  expect(Object.keys(config(world).firewall.napplets)).toHaveLength(count);
});

When('the guard registers rules for applet {string}', (world: GuardWorld, napplet: string) => {
  scratch(world).config = applyNappletRules(config(world), napplet);
});

When('the guard firewall gives applet {string} the {string} policy', (world: GuardWorld, napplet: string, policy: 'allow' | 'deny' | 'ask') => {
  const current = config(world);
  scratch(world).config = { ...current, firewall: setPolicy(current.firewall, napplet, policy) };
});

Then(
  'the guard firewall rate for applet {string} and class {string} is {int} per {int} ms with action {string}',
  (world: GuardWorld, napplet: string, opClass: string, capacity: number, windowMs: number, action: string) => {
    expect(config(world).firewall.napplets[napplet]?.rateLimits[opClass]).toEqual({ capacity, windowMs, action });
  },
);

Then('the guard firewall global rate for applet {string} is {int} per {int} ms', (world: GuardWorld, napplet: string, capacity: number, windowMs: number) => {
  expect(config(world).firewall.napplets[napplet]?.globalRate).toEqual({ capacity, windowMs, action: 'block' });
});

Then('the guard firewall policy for applet {string} is {string}', (world: GuardWorld, napplet: string, policy: string) => {
  expect(config(world).firewall.napplets[napplet]?.policy).toBe(policy);
});

Then('the original guard firewall still has no applet rules', (world: GuardWorld) => {
  expect(scratch(world).original?.napplets).toEqual({});
});
