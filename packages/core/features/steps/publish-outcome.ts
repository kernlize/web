import { expect } from 'vitest';
import { DataTable, Given, Then } from 'quickpickle';
import { describeOutcome, summarizePublish, type PublishOutcome } from '@kernlize/core';
import { scratch, splitList, type CoreWorld } from './world.js';

/** The outcome of the last publish a scenario looked at, from a table or a save. */
export function outcome(world: CoreWorld): PublishOutcome {
  const value = scratch(world).outcome as PublishOutcome | undefined;
  if (!value) throw new Error('publish something first');
  return value;
}

Given('the servers answered a publish with', (world: CoreWorld, table: DataTable) => {
  const responses = table.hashes().map((row) => ({
    from: row.server as string,
    ok: row.accepted === 'yes',
    ...(row.reason ? { message: row.reason } : {}),
  }));
  scratch(world).outcome = summarizePublish(responses);
});

Then('the publish succeeded', (world: CoreWorld) => {
  expect(outcome(world).ok).toBe(true);
});

Then('the publish failed', (world: CoreWorld) => {
  expect(outcome(world).ok).toBe(false);
});

Then('it was accepted by {string}', (world: CoreWorld, urls: string) => {
  expect(outcome(world).accepted).toEqual(splitList(urls));
});

Then('{string} refused it with {string}', (world: CoreWorld, url: string, reason: string) => {
  expect(outcome(world).refused).toContainEqual({ url, reason });
});

Then('the person is told {string}', (world: CoreWorld, sentence: string) => {
  expect(describeOutcome(outcome(world))).toBe(sentence);
});
