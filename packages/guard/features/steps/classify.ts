import { expect } from 'vitest';
import { Then } from 'quickpickle';
import { classifyEnvelope, estimateEnvelopeSize } from '@kernl/guard';
import type { GuardWorld } from './world.js';

Then('the guard classifies {string} as {string}', (_world: GuardWorld, type: string, opClass: string) => {
  expect(classifyEnvelope({ type })).toBe(opClass);
});

Then('the guard classifies {string} with kind {int} as {string}', (_world: GuardWorld, type: string, kind: number, opClass: string) => {
  expect(classifyEnvelope({ type, kind })).toBe(opClass);
});

Then('the guard estimates the envelope {string} as {int} bytes', (_world: GuardWorld, json: string, bytes: number) => {
  expect(estimateEnvelopeSize(JSON.parse(json))).toBe(bytes);
});

Then('the guard estimates an unserialisable value as {int} bytes', (_world: GuardWorld, bytes: number) => {
  expect(estimateEnvelopeSize({ big: BigInt(1) })).toBe(bytes);
});
