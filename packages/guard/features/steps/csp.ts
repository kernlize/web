import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import { createAppletCsp, renderCsp, type GuardProfile } from '@kernlize/guard';
import { scratch, type GuardWorld } from './world.js';

function csp(world: GuardWorld) {
  const { csp } = scratch(world);
  if (!csp) throw new Error('build the CSP first');
  return csp;
}

When('the guard builds the applet CSP for the {string} profile', (world: GuardWorld, profile: GuardProfile) => {
  scratch(world).csp = createAppletCsp(profile);
});

Then('the guard CSP grants no connection origins', (world: GuardWorld) => {
  expect(csp(world).connectOrigins).toEqual([]);
});

Then('the guard CSP directive {string} is {string}', (world: GuardWorld, name: string, sources: string) => {
  expect(csp(world).directives[name]?.join(' ')).toBe(sources);
});

Then('the guard CSP has {int} directives', (world: GuardWorld, count: number) => {
  expect(Object.keys(csp(world).directives)).toHaveLength(count);
});

Then('the guard CSP for the {string} profile equals the CSP for the {string} profile', (_world: GuardWorld, a: GuardProfile, b: GuardProfile) => {
  expect(createAppletCsp(a)).toEqual(createAppletCsp(b));
});

When('the guard renders the CSP', (world: GuardWorld) => {
  scratch(world).rendered = renderCsp(csp(world).directives);
});

Then('the rendered guard CSP is:', (world: GuardWorld, policy: string) => {
  expect(scratch(world).rendered).toBe(policy.trim());
});
