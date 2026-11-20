import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import type { GuardEvent } from '@kernlize/guard';
import type { AppletMessage } from '../../src/shell/contract.ts';
import { countMark, describeMarks, directionLabel, entryOfGuardEvent, entryOfMessage, formatPayload, type TrafficEntry, type TrafficMarks } from '../../src/shell/traffic-words.ts';

interface TrafficWorld {
  row?: TrafficEntry;
  marks?: TrafficMarks;
}

When('the inspector reads a {string} {string} message whose failure is {string}', (world: TrafficWorld, direction: AppletMessage['direction'], type: string, failure: string) => {
  world.row = entryOfMessage({ windowId: 'w1', direction, via: 'port', type, message: { type }, at: 1, ...(failure ? { error: failure } : {}) }, 1);
});

When('the inspector reads a guard {string} for {string} on {string} described as {string}', (world: TrafficWorld, disposition: GuardEvent['disposition'], reason: string, opClass: GuardEvent['opClass'], words: string) => {
  world.row = entryOfGuardEvent({ disposition, windowId: 'w1', napplet: 'n', opClass, reason, at: 1 }, 2, words);
});

Then('the inspector row is marked {string} with the note {string}', (world: TrafficWorld, mark: string, note: string) => {
  expect(world.row?.mark ?? '').toBe(mark);
  expect(world.row?.note ?? '').toBe(note);
});

Then('the inspector row reads {string}', (world: TrafficWorld, label: string) => {
  expect(directionLabel(world.row as TrafficEntry)).toBe(label);
});

Then('the inspector shows nothing for a guard {string}', (_world: TrafficWorld, disposition: GuardEvent['disposition']) => {
  expect(entryOfGuardEvent({ disposition, windowId: 'w1', napplet: 'n', opClass: 'generic', reason: 'ok', at: 1 }, 3, '')).toBeUndefined();
});

When('the inspector counts marks {string}', (world: TrafficWorld, marks: string) => {
  world.marks = marks.split(',').reduce<TrafficMarks>((counts, mark) => countMark(counts, (mark ? { mark } : {}) as TrafficEntry), { errors: 0, warnings: 0 });
});

Then('the inspector counts read {string}', (world: TrafficWorld, words: string) => {
  expect(describeMarks(world.marks as TrafficMarks)).toBe(words);
});

const circular: Record<string, unknown> = {};
circular.self = circular;
const SHOWN: Readonly<Record<string, string>> = { 'two-space JSON of its type': '{\n  "type": "shell.ready"\n}' };
const PAYLOADS: Readonly<Record<string, unknown>> = { object: { type: 'shell.ready' }, undefined: undefined, circular };

Then('the payload {word} is shown as {}', (_world: TrafficWorld, payload: string, shown: string) => {
  expect(formatPayload(PAYLOADS[payload])).toBe(SHOWN[shown] ?? shown);
});

Then('the inspector row\'s type is {string}', (world: TrafficWorld, type: string) => {
  expect(world.row?.type).toBe(type);
});
