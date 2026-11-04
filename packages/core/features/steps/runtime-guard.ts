import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { NappletRevocationReason } from '@kehto/shell';
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

Then('the oversized {string} request got no answer', (world: CoreWorld, type: string) => {
  expect(k(world).received.filter((entry) => entry.id === `${type}-oversized`)).toEqual([]);
});

Then('the fake bridges were asked for nothing', (world: CoreWorld) => {
  expect(k(world).bridgeCalls).toEqual([]);
});

Then('the runtime firewall scales unfocused budgets by {float} and allows {int} operations in a window\'s first {int} ms', (world: CoreWorld, multiplier: number, maxOps: number, windowMs: number) => {
  const config = firewall(world).getConfig();
  expect(config.unfocusedMultiplier).toBe(multiplier);
  expect(config.burstGuard).toEqual({ windowMs, maxOps, action: 'block' });
});

Then('the runtime ACL refuses {string} to an applet the user never granted anything', (world: CoreWorld, capability: 'relay:read') => {
  expect(k(world).kernl.bridge.runtime.aclState.check('', 'stranger', 'ab'.repeat(32), capability)).toBe(false);
});

Then('the host storage holds the runtime firewall config under {string}', (world: CoreWorld, key: string) => {
  const stored = JSON.parse(scratch(world).storage.getItem(key) ?? '{}') as { napplets?: Record<string, unknown> };
  expect(stored.napplets?.chat).toBeDefined();
});

When('kehto revokes the mounted window for {string}', (world: CoreWorld, reason: NappletRevocationReason) => {
  k(world).kernl.bridge.revokeNapplet(k(world).plan?.windowId ?? '', reason);
});

Given('the applet\'s startup window has passed', (world: CoreWorld) => {
  advance(world, 1000);
});

Then('no guard event carries the applet\'s message', (world: CoreWorld) => {
  for (const event of k(world).guardEvents) expect(Object.keys(event).sort()).toEqual(['at', 'disposition', 'napplet', 'opClass', 'reason', 'windowId']);
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

/** The manual clock also drives `Date`, because kehto's runtime reads `Date.now()` for its budgets and startup window. */
function advance(world: CoreWorld, ms: number): void {
  scratch(world).clock = (scratch(world).clock as number) + ms;
  vi.setSystemTime(scratch(world).clock as number);
}

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

Then('{string} requests {int} to {int} got no answer', (world: CoreWorld, type: string, from: number, to: number) => {
  for (let n = from; n <= to; n += 1) expect(answerTo(world, type, n), `${type}-${n}`).toBeUndefined();
});

Then('at least one {string} request got no answer', (world: CoreWorld, type: string) => {
  const sent = scratch(world)[`sent:${type}`] as number;
  expect(Array.from({ length: sent }, (_, i) => answerTo(world, type, i + 1)).some((answer) => answer === undefined)).toBe(true);
});

Then('{string} requests {int} to {int} were refused by the firewall', (world: CoreWorld, type: string, from: number, to: number) => {
  for (let n = from; n <= to; n += 1) expect(refused(answerTo(world, type, n)), `${type}-${n}`).toBe(true);
});

