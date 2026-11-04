import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { refuseCurrentDispatch } from '@kernl/core';
import { k, settle } from './kernl.js';
import { scratch, type CoreWorld } from './world.js';

/** The fake bridges answer any address under this prefix. */
const FILES = 'https://files.example/';

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
  k(world).channel?.port1.postMessage({ type, id: `${type}-oversized`, url: FILES + 'a'.repeat(kib * 1024 - FILES.length) });
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

const VISIBILITY = {
  hidden: { visible: false, focused: false },
  'visible but not focused': { visible: true, focused: false },
  focused: { visible: true, focused: true },
} as const;

When('the applet window becomes {string}', (world: CoreWorld, state: keyof typeof VISIBILITY) => {
  k(world).handle?.setVisibility(VISIBILITY[state]);
});

When('the applet sends {int} {string} requests over its port, {int} ms apart', async (world: CoreWorld, count: number, type: string, gap: number) => {
  const port = k(world).channel?.port1;
  if (!port) throw new Error('hello first');
  const base = (scratch(world)[`sent:${type}`] as number | undefined) ?? 0;
  for (let i = 1; i <= count; i += 1) {
    port.postMessage({ type, id: `${type}-${base + i}`, url: `${FILES}a.txt`, key: 'k', value: 'v' });
    if (gap > 0) {
      await settle();
      scratch(world).clock = (scratch(world).clock as number) + gap;
    }
  }
  scratch(world)[`sent:${type}`] = base + count;
  await settle();
});

function answerTo(world: CoreWorld, type: string, n: number): Record<string, unknown> | undefined {
  return k(world).received.find((entry) => entry.id === `${type}-${n}`);
}

function refused(answer: Record<string, unknown> | undefined): boolean {
  return String(answer?.error).startsWith('firewall: ');
}

Then('{string} requests {int} to {int} were answered', (world: CoreWorld, type: string, from: number, to: number) => {
  for (let n = from; n <= to; n += 1) {
    const answer = answerTo(world, type, n);
    expect(answer, `${type}-${n}`).toBeDefined();
    expect(answer?.error, `${type}-${n}`).toBeUndefined();
  }
});

Then('{string} requests {int} to {int} were refused by the firewall', (world: CoreWorld, type: string, from: number, to: number) => {
  for (let n = from; n <= to; n += 1) expect(refused(answerTo(world, type, n)), `${type}-${n}`).toBe(true);
});

Then('at least one {string} request was refused by the firewall', (world: CoreWorld, type: string) => {
  const sent = scratch(world)[`sent:${type}`] as number;
  expect(Array.from({ length: sent }, (_, i) => answerTo(world, type, i + 1)).some(refused)).toBe(true);
});
