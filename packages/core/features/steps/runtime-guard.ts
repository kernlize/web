import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { refuseCurrentDispatch } from '@kernl/core';
import { k, settle } from './kernl.js';
import { scratch, type CoreWorld } from './world.js';

function firewall(world: CoreWorld) {
  return k(world).kernl.bridge.runtime.firewallState;
}

function policyOf(world: CoreWorld, napplet: string): string {
  return firewall(world).getConfig().napplets[napplet]?.policy ?? 'none';
}

Then('the applet received no {string}', (world: CoreWorld, type: string) => {
  expect(k(world).received.map((entry) => entry.type)).not.toContain(type);
});

When('the applet asks {string} for an address of {int} KiB over its port', async (world: CoreWorld, type: string, kib: number) => {
  const prefix = 'https://files.example/';
  k(world).channel?.port1.postMessage({ type, id: `${type}-oversized`, url: prefix + 'a'.repeat(kib * 1024 - prefix.length) });
  await settle();
});

Then('the applet received a {string} naming the firewall', (world: CoreWorld, type: string) => {
  const answer = k(world).received.find((entry) => entry.type === type);
  expect(answer).toMatchObject({ id: `${type.replace(/\.error$/, '')}-oversized` });
  expect(String(answer?.error)).toMatch(/^firewall: /);
});

Then('the fake bridges were asked for nothing', (world: CoreWorld) => {
  expect(k(world).bridgeCalls).toEqual([]);
});

Given('the runtime firewall holds the policy {string} for {string}', (world: CoreWorld, policy: 'ask', napplet: string) => {
  firewall(world).setPolicy(napplet, policy);
});

When('the shell refuses the current dispatch for {string} and for {string}', (world: CoreWorld, first: string, second: string) => {
  refuseCurrentDispatch(firewall(world), first);
  refuseCurrentDispatch(firewall(world), second);
  scratch(world).duringDispatch = [policyOf(world, first), policyOf(world, second)];
});

Then('during that dispatch the runtime firewall policies were {string} and {string}', (world: CoreWorld, first: string, second: string) => {
  expect(scratch(world).duringDispatch).toEqual([first, second]);
});

Then('afterwards the runtime firewall policy for {string} is {string} and for {string} is {string}', (world: CoreWorld, first: string, firstPolicy: string, second: string, secondPolicy: string) => {
  expect([policyOf(world, first), policyOf(world, second)]).toEqual([firstPolicy, secondPolicy]);
});

Then('the runtime firewall holds no policy for {string} and a {string} rate of {int} per {int} ms', (world: CoreWorld, napplet: string, opClass: string, capacity: number, windowMs: number) => {
  const rules = firewall(world).getConfig().napplets[napplet];
  expect(policyOf(world, napplet)).toBe('none');
  expect(rules?.rateLimits[opClass]).toEqual({ capacity, windowMs, action: 'block' });
});
