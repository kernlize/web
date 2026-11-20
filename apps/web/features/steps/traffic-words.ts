import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import type { GuardEvent } from '@kernlize/guard';
import type { AppletMessage } from '../../src/shell/contract.ts';
import { countMark, describeMarks, directionLabel, entryOfGuardEvent, entryOfMessage, formatPayload, trimPayload, type TrafficEntry, type TrafficMarks } from '../../src/shell/traffic-words.ts';

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

const nested = (depth: number, wrap: (inner: unknown) => unknown): unknown => (depth === 0 ? 'bottom' : wrap(nested(depth - 1, wrap)));
const selfish: Record<string, unknown> = { name: 'loop' };
selfish.again = selfish;
const LONG = 'A'.repeat(4000);
const SHARED = { n: 1 };
const WIDE: Record<string, number> = Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`k${index}`, index]));
// Each row costs 51 values of the 2000: rows 0 to 39 fit, and the rows after them are cut short.
const GRID = Array.from({ length: 50 }, () => Array.from({ length: 50 }, (_, index) => index));
const GRID_KEPT = GRID.map((row, index) => (index < 40 ? row : '<array>'));
const KEPT: Readonly<Record<string, [unknown, unknown]>> = {
  'a 4000-character string': [{ blob: LONG }, { blob: `${'A'.repeat(64)}… (4000 characters)` }],
  'a 512-character string': ['B'.repeat(512), 'B'.repeat(512)],
  '2048 bytes': [new Uint8Array(2048), '<Uint8Array 2048 bytes>'],
  'a 10-byte buffer': [new ArrayBuffer(10), '<ArrayBuffer 10 bytes>'],
  'a 3-byte blob': [new Blob(['abc']), '<Blob 3 bytes>'],
  'an object inside itself': [selfish, { name: 'loop', again: '<circular>' }],
  'nesting eight objects deep': [nested(8, (inner) => ({ inner })), { inner: { inner: { inner: { inner: { inner: { inner: '<object>' } } } } } }],
  'nesting eight arrays deep': [nested(8, (inner) => [inner]), [[[[[['<array>']]]]]]],
  'a number': [42, 42],
  'a shared value used twice': [{ a: SHARED, b: SHARED }, { a: { n: 1 }, b: { n: 1 } }],
  'a million-item array': [Array.from({ length: 1_000_000 }).fill(0), [...Array.from({ length: 50 }).fill(0), '<999950 more>']],
  'an object with an inherited key': [Object.assign(Object.create({ inherited: 1 }), { own: 2 }), { own: 2 }],
  'an object with 60 keys': [WIDE, { ...Object.fromEntries(Object.entries(WIDE).slice(0, 50)), '…': 'more keys' }],
  'a big integer': [12345678901234567890n, '12345678901234567890n'],
  '50 arrays of 50 numbers': [GRID, GRID_KEPT],
};

Then('the inspector keeps {} as {}', (_world: TrafficWorld, payload: string) => {
  const [given, kept] = KEPT[payload] ?? [];
  expect(trimPayload(given)).toEqual(kept);
});
