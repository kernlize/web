import { expect } from 'vitest';
import { Then } from 'quickpickle';
import type {
  AppletCsp,
  FocusFirewall,
  GuardConfig,
  GuardDisposition,
  GuardEnvelope,
  GuardEvent,
  IngressGuard,
  MitigationDescription,
  VisibilityGate,
  WindowVisibility,
} from '@kernlize/guard';
import type { EvaluateResult, FirewallConfig } from '@kehto/firewall';

/** Scenario state. quickpickle hands every step the same world object. */
export interface GuardScratch {
  events: GuardEvent[];
  clock: number;
  config?: GuardConfig;
  original?: FirewallConfig;
  ingress?: IngressGuard;
  gate?: VisibilityGate;
  firewall?: FocusFirewall;
  visibility: WindowVisibility;
  dispositions: GuardDisposition[];
  drained?: readonly GuardEnvelope[];
  deferred?: boolean;
  result?: EvaluateResult;
  csp?: AppletCsp;
  rendered?: string;
  mitigations?: readonly MitigationDescription[];
}

export interface GuardWorld {
  guard?: GuardScratch;
}

export function scratch(world: GuardWorld): GuardScratch {
  world.guard ??= { events: [], clock: 0, visibility: { visible: true, focused: true }, dispositions: [] };
  return world.guard;
}

export function last<T>(items: readonly T[]): T {
  const item = items.at(-1);
  if (item === undefined) throw new Error('expected at least one item');
  return item;
}

export function splitList(list: string): string[] {
  return list.split(',').map((part) => part.trim());
}

Then('the guard emitted {int} events', (world: GuardWorld, count: number) => {
  expect(scratch(world).events).toHaveLength(count);
});

Then('the guard emitted no events', (world: GuardWorld) => {
  expect(scratch(world).events).toEqual([]);
});

Then('the guard\'s last event has disposition {string} and reason {string}', (world: GuardWorld, disposition: string, reason: string) => {
  const event = last(scratch(world).events);
  expect(event.disposition).toBe(disposition);
  expect(event.reason).toBe(reason);
});

Then(
  'the guard\'s last event names window {string} and applet {string} with class {string}',
  (world: GuardWorld, windowId: string, napplet: string, opClass: string) => {
    const event = last(scratch(world).events);
    expect(event.windowId).toBe(windowId);
    expect(event.napplet).toBe(napplet);
    expect(event.opClass).toBe(opClass);
    expect(event.at).toBe(scratch(world).clock);
  },
);

Then('the guard drained envelope types {string}', (world: GuardWorld, list: string) => {
  expect(scratch(world).drained?.map((envelope) => envelope.type)).toEqual(splitList(list));
});

Then('the guard drained nothing', (world: GuardWorld) => {
  expect(scratch(world).drained).toEqual([]);
});

Then('the guard drained {int} envelopes', (world: GuardWorld, count: number) => {
  expect(scratch(world).drained).toHaveLength(count);
});
