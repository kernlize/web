import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { NappletRevocationReason } from '@kehto/shell';
import { runtimeOpClass } from '@kernlize/core';
import { k, settle } from './kernl.js';
import { scratch, type CoreWorld } from './world.js';

/** The fake bridges answer any address under this prefix. */
const FILES = 'https://files.example/';

Then('the applet received no {string}', (world: CoreWorld, type: string) => {
  expect(k(world).received.map((entry) => entry.type)).not.toContain(type);
});

When('the applet asks {string} for an address of {int} KiB over its port', async (world: CoreWorld, type: string, kib: number) => {
  k(world).channel?.port1.postMessage({ type, id: `${type}-oversized`, url: FILES + 'a'.repeat(kib * 1024 - FILES.length) });
  await settle();
});

Then('the oversized {string} request got no answer', (world: CoreWorld, type: string) => {
  expect(k(world).received.filter((entry) => entry.id === `${type}-oversized`)).toEqual([]);
});

Then('the fake bridges were asked for nothing', (world: CoreWorld) => {
  expect(k(world).bridgeCalls).toEqual([]);
});

Then('the runtime charges what it carries out against the guard\'s budgets, a {string} at {int} per {int} ms', (world: CoreWorld, operation: string, capacity: number, windowMs: number) => {
  const { permissions, legacyFirewall } = k(world).kernl.bridge.runtime;
  expect(permissions?.available).toBe(true);
  expect(legacyFirewall).toBeUndefined();
  expect(k(world).kernl.guard.config.rateLimits[runtimeOpClass(operation)]).toMatchObject({ capacity, windowMs, action: 'block' });
});

Then('the runtime ACL refuses {string} to an applet the user never granted anything', (world: CoreWorld, capability: 'relay:read') => {
  expect(k(world).kernl.bridge.runtime.aclState.check('', 'stranger', 'ab'.repeat(32), capability)).toBe(false);
});

Then('the host storage no longer holds {string}', (world: CoreWorld, key: string) => {
  expect(scratch(world).storage.getItem(key)).toBeNull();
});

When('kehto revokes the mounted window for {string}', (world: CoreWorld, reason: NappletRevocationReason) => {
  k(world).kernl.bridge.revokeNapplet(k(world).plan?.windowId ?? '', reason);
});

Given('the host storage holds {string} under {string}', (world: CoreWorld, value: string, key: string) => {
  scratch(world).storage.setItem(key, value);
});

Then('the rogue window got no answer', (world: CoreWorld) => {
  const answers = k(world).received.filter((entry) => typeof entry.id === 'string' && (entry.id.startsWith('rogue') || entry.id === 'publish-1'));
  expect(answers).toEqual([]);
});

Then('no guard event carries the applet\'s message', (world: CoreWorld) => {
  for (const event of k(world).guardEvents) expect(Object.keys(event).sort()).toEqual(['at', 'disposition', 'napplet', 'opClass', 'reason', 'windowId']);
});

const VISIBILITY = {
  hidden: { visible: false, focused: false },
  'visible but not focused': { visible: true, focused: false },
  focused: { visible: true, focused: true },
} as const;

When('the applet window becomes {string}', async (world: CoreWorld, state: keyof typeof VISIBILITY) => {
  k(world).handle?.setVisibility(VISIBILITY[state]);
  await settle();
});

When('the applet sends {int} {string} requests over its port, {int} ms apart', async (world: CoreWorld, count: number, type: string, gap: number) => {
  const port = k(world).channel?.port1;
  if (!port) throw new Error('hello first');
  const base = (scratch(world)[`sent:${type}`] as number | undefined) ?? 0;
  for (let i = 1; i <= count; i += 1) {
    port.postMessage({ type, id: `${type}-${base + i}`, url: `${FILES}a.txt`, key: 'k', value: 'v' });
    if (gap > 0) {
      await settle();
      advance(world, gap);
    }
  }
  scratch(world)[`sent:${type}`] = base + count;
  await settle();
});

/** The manual clock also drives `Date`, which kehto's runtime reads for the times it stamps. */
function advance(world: CoreWorld, ms: number): void {
  scratch(world).clock = (scratch(world).clock as number) + ms;
  vi.setSystemTime(scratch(world).clock as number);
}

function answerTo(world: CoreWorld, type: string, n: number): Record<string, unknown> | undefined {
  return k(world).received.find((entry) => entry.id === `${type}-${n}`);
}

function refused(answer: Record<string, unknown> | undefined): boolean {
  return answer?.error === 'rate limit exceeded';
}

Then('{string} requests {int} to {int} were answered', (world: CoreWorld, type: string, from: number, to: number) => {
  for (let n = from; n <= to; n += 1) {
    const answer = answerTo(world, type, n);
    expect(answer, `${type}-${n}`).toBeDefined();
    expect(answer?.error, `${type}-${n}`).toBeUndefined();
  }
});

Then('{string} requests {int} to {int} got no answer', (world: CoreWorld, type: string, from: number, to: number) => {
  for (let n = from; n <= to; n += 1) expect(answerTo(world, type, n), `${type}-${n}`).toBeUndefined();
});

Then('at least one {string} request got no answer', (world: CoreWorld, type: string) => {
  const sent = scratch(world)[`sent:${type}`] as number;
  expect(Array.from({ length: sent }, (_, i) => answerTo(world, type, i + 1)).some((answer) => answer === undefined)).toBe(true);
});

Then('{string} requests {int} to {int} were refused for the rate limit', (world: CoreWorld, type: string, from: number, to: number) => {
  for (let n = from; n <= to; n += 1) expect(refused(answerTo(world, type, n)), `${type}-${n}`).toBe(true);
});

