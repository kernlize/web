import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createGuardConfig, type GuardEvent, type GuardProfile, type WindowVisibility } from '@kernl/guard';
import type { NappletMessageDecision } from '@kehto/shell';
import type { Decision } from '@kehto/firewall';
import { createGuardPipeline, createRuntimeFirewallHooks, type GuardPipeline, type PipelineDisposition, type WindowResolution } from '@kernl/core';
import { scratch, splitList, type CoreWorld } from './world.js';

interface PipelineRecord {
  clock: { now: number };
  events: GuardEvent[];
  forwarded: MessageEvent[];
  windows: Map<string, string>;
  origins: WeakMap<MessageEvent, string>;
  hostVisibility: Map<string, WindowVisibility>;
  quarantines: Array<{ windowId: string; napplet: string }>;
  released: string[];
  disposition?: PipelineDisposition | NappletMessageDecision;
  profiles: GuardProfile[];
}

interface PipelineScratch extends PipelineRecord {
  pipeline: GuardPipeline;
}

function freshRecord(): PipelineRecord {
  return { clock: { now: 0 }, events: [], forwarded: [], windows: new Map(), origins: new WeakMap(), hostVisibility: new Map(), quarantines: [], released: [], profiles: [] };
}

const HIDDEN: WindowVisibility = { visible: false, focused: false };
const VISIBLE: WindowVisibility = { visible: true, focused: true };

function state(world: CoreWorld): PipelineScratch {
  const value = scratch(world).pipeline as PipelineScratch | undefined;
  if (!value) throw new Error('create a pipeline first');
  return value;
}

function messageFrom(world: CoreWorld, windowId: string | null, type: string): MessageEvent {
  const event = { data: { type } } as MessageEvent;
  if (windowId) state(world).origins.set(event, windowId);
  return event;
}

function resolver(world: CoreWorld): (event: MessageEvent) => WindowResolution | null {
  return (event) => {
    const windowId = state(world).origins.get(event);
    const napplet = windowId ? state(world).windows.get(windowId) : undefined;
    return windowId && napplet ? { windowId, napplet } : null;
  };
}

function send(world: CoreWorld, windowId: string | null, type: string): void {
  const s = state(world);
  s.disposition = s.pipeline.handleWindowMessage(messageFrom(world, windowId, type), resolver(world), (event) => void s.forwarded.push(event));
}

Given('a kernl guard pipeline using the {string} profile with a controlled clock', (world: CoreWorld, profile: GuardProfile) => {
  const record = freshRecord();
  const pipeline = createGuardPipeline({
    config: createGuardConfig(profile),
    now: () => record.clock.now,
    onEvent: (event) => void record.events.push(event),
    onQuarantine: (windowId, napplet) => void record.quarantines.push({ windowId, napplet }),
    getVisibility: (windowId) => record.hostVisibility.get(windowId) ?? VISIBLE,
    onRelease: (windowId) => void record.released.push(windowId),
  });
  pipeline.profile$.subscribe((value) => record.profiles.push(value));
  scratch(world).pipeline = { ...record, pipeline } satisfies PipelineScratch;
});

Given('a kernl guard pipeline using the {string} profile with default options', (world: CoreWorld, profile: GuardProfile) => {
  scratch(world).pipeline = { ...freshRecord(), pipeline: createGuardPipeline({ config: createGuardConfig(profile) }) } satisfies PipelineScratch;
});

Given('pipeline window {string} runs applet {string}', (world: CoreWorld, windowId: string, napplet: string) => {
  state(world).windows.set(windowId, napplet);
});

Given('pipeline window {string} is hidden', (world: CoreWorld, windowId: string) => {
  state(world).pipeline.setVisibility(windowId, HIDDEN);
});

Given('the host reports window {string} as hidden', (world: CoreWorld, windowId: string) => {
  state(world).hostVisibility.set(windowId, HIDDEN);
});

When('a window message of type {string} arrives from an unknown window', (world: CoreWorld, type: string) => {
  send(world, null, type);
});

When('a window message of type {string} arrives from window {string}', (world: CoreWorld, type: string, windowId: string) => {
  send(world, windowId, type);
});

When('{int} window messages of type {string} arrive from window {string}', (world: CoreWorld, count: number, type: string, windowId: string) => {
  for (let i = 0; i < count; i += 1) send(world, windowId, type);
});

When('{int} paced window messages of type {string} arrive from window {string}', (world: CoreWorld, count: number, type: string, windowId: string) => {
  for (let i = 0; i < count; i += 1) {
    if (i > 0 && i % 8 === 0) state(world).clock.now += 1000;
    send(world, windowId, type);
  }
});

When('paced window messages of type {string} arrive from window {string} until one is rejected, at most {int}', (world: CoreWorld, type: string, windowId: string, max: number) => {
  for (let i = 0; i < max; i += 1) {
    if (i > 0 && i % 8 === 0) state(world).clock.now += 1000;
    send(world, windowId, type);
    if (state(world).disposition === 'reject') return;
  }
});

When('the pipeline clock advances by {int} ms', (world: CoreWorld, ms: number) => {
  state(world).clock.now += ms;
});

When('the pipeline drains window {string}', (world: CoreWorld, windowId: string) => {
  state(world).pipeline.drainAll(windowId);
});

When('the pipeline marks window {string} visible', (world: CoreWorld, windowId: string) => {
  state(world).pipeline.setVisibility(windowId, VISIBLE);
});

When('the pipeline forgets window {string}', (world: CoreWorld, windowId: string) => {
  state(world).pipeline.forget(windowId);
});

When('the pipeline releases window {string}', (world: CoreWorld, windowId: string) => {
  state(world).pipeline.release(windowId);
});

When('the pipeline profile is set to {string}', (world: CoreWorld, profile: GuardProfile) => {
  state(world).pipeline.setProfile(profile);
});

When('the pipeline observes {int} port envelopes of type {string} from window {string}', (world: CoreWorld, count: number, type: string, windowId: string) => {
  const s = state(world);
  for (let i = 0; i < count; i += 1) s.disposition = s.pipeline.observe(windowId, s.windows.get(windowId) ?? 'unknown', { type });
});

When('the pipeline observes {int} paced port envelopes of type {string} from window {string}', (world: CoreWorld, count: number, type: string, windowId: string) => {
  const s = state(world);
  for (let i = 0; i < count; i += 1) {
    if (i > 0 && i % 8 === 0) s.clock.now += 1000;
    s.disposition = s.pipeline.observe(windowId, s.windows.get(windowId) ?? 'unknown', { type });
  }
});

When('the pipeline observes a port envelope of type {string} from window {string}', (world: CoreWorld, type: string, windowId: string) => {
  const s = state(world);
  s.disposition = s.pipeline.observe(windowId, s.windows.get(windowId) ?? 'unknown', { type });
});

When('the pipeline observes port envelopes of type {string} from window {string} until it quarantines, at most {int}', (world: CoreWorld, type: string, windowId: string, max: number) => {
  const s = state(world);
  for (let i = 0; i < max && s.quarantines.length === 0; i += 1) {
    s.disposition = s.pipeline.observe(windowId, s.windows.get(windowId) ?? 'unknown', { type });
  }
});

When('the pipeline observes a port envelope that is not an object from window {string}', (world: CoreWorld, windowId: string) => {
  const s = state(world);
  s.disposition = s.pipeline.observe(windowId, 'chat', 'just a string');
});

When('the pipeline observes a kind {int} {string} port envelope from window {string}', (world: CoreWorld, kind: number, type: string, windowId: string) => {
  const s = state(world);
  s.disposition = s.pipeline.observe(windowId, 'chat', { type, event: { kind } });
});

Then('the pipeline disposition was {string}', (world: CoreWorld, disposition: string) => {
  expect(state(world).disposition).toBe(disposition);
});

Then('{int} messages were forwarded', (world: CoreWorld, count: number) => {
  expect(state(world).forwarded).toHaveLength(count);
});

Then('at least {int} messages were forwarded', (world: CoreWorld, count: number) => {
  expect(state(world).forwarded.length).toBeGreaterThanOrEqual(count);
});

Then('the pipeline emitted guard events with reasons {string}', (world: CoreWorld, reasons: string) => {
  const seen = new Set(state(world).events.map((event) => event.reason));
  for (const reason of splitList(reasons)) expect(seen.has(reason)).toBe(true);
});

Then('the quarantine callback named window {string} and applet {string}', (world: CoreWorld, windowId: string, napplet: string) => {
  expect(state(world).quarantines).toEqual([{ windowId, napplet }]);
});

Then('window {string} is quarantined', (world: CoreWorld, windowId: string) => {
  expect(state(world).pipeline.isQuarantined(windowId)).toBe(true);
});

Then('window {string} is not quarantined', (world: CoreWorld, windowId: string) => {
  expect(state(world).pipeline.isQuarantined(windowId)).toBe(false);
});

Then('the pipeline reports window {string} as hidden', (world: CoreWorld, windowId: string) => {
  expect(state(world).pipeline.getVisibility(windowId)).toEqual(HIDDEN);
});

Then('the pipeline asked to release nothing', (world: CoreWorld) => {
  expect(state(world).released).toEqual([]);
});

Then('the pipeline asked to release window {string}', (world: CoreWorld, windowId: string) => {
  expect(state(world).released).toEqual([windowId]);
});

Then('the pipeline profile is {string}', (world: CoreWorld, profile: GuardProfile) => {
  expect(state(world).pipeline.config.profile).toBe(profile);
  expect(state(world).profiles.at(-1)).toBe(profile);
});

When('the runtime firewall reports rule {string} with decision {string} for {string}', (world: CoreWorld, ruleId: string, decision: Decision, opClass: string) => {
  const events: GuardEvent[] = [];
  const hooks = createRuntimeFirewallHooks({ storage: scratch(world).storage, onEvent: (event) => void events.push(event) });
  hooks.onFirewallEvent({ windowId: 'w1', napplet: 'chat', opClass, decision, action: 'block', ruleId, reason: 'secret detail', message: { type: 'storage.set', value: 'secret' } as never });
  scratch(world).runtimeEvents = events;
});

Then('the guard was told of a {string} of {string} because {string}, and nothing else', (world: CoreWorld, disposition: string, opClass: string, reason: string) => {
  const events = scratch(world).runtimeEvents as GuardEvent[];
  expect(events).toEqual([{ disposition, windowId: 'w1', napplet: 'chat', opClass, reason, at: expect.any(Number) }]);
});
