import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import { createGuardConfig, GUARD_PROFILES, type GuardLimits, type GuardProfile, type OpClass } from '@kernlize/guard';
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
  expect(built.profile).toBe(profile);
});

Then('the guard limit {string} is {float}', (world: GuardWorld, name: keyof GuardLimits, value: number) => {
  expect(config(world).limits[name]).toBe(value);
});

Then('the guard rate {string} is {int} per {int} ms', (world: GuardWorld, opClass: OpClass, capacity: number, windowMs: number) => {
  expect(config(world).limits.rates[opClass]).toEqual({ capacity, windowMs });
});

Then(
  'the guard budget for {string} is {int} per {int} ms with action {string}',
  (world: GuardWorld, opClass: OpClass, capacity: number, windowMs: number, action: string) => {
    expect(config(world).rateLimits[opClass]).toMatchObject({ capacity, windowMs, action });
  },
);

Then('every guard budget has unfocused multiplier {float}', (world: GuardWorld, value: number) => {
  const budgets = Object.values(config(world).rateLimits);
  expect(budgets).toHaveLength(Object.keys(config(world).limits.rates).length);
  for (const budget of budgets) expect(budget.unfocusedMultiplier).toBe(value);
});

Then('no guard budget has a startup burst of its own', (world: GuardWorld) => {
  for (const budget of Object.values(config(world).rateLimits)) expect(budget.burst.windowMs).toBe(0);
});
