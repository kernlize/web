import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import { EventStore } from 'applesauce-core';
import type { ConsentRequest } from '@kehto/runtime';
import type { NostrEvent } from '@napplet/core';
import { createConsentHandler, describeChange, lookupReplaceable, type AppletIdentity, type ConsentPrompt, type ConsentSummary } from '@kernl/core';
import { scratch, signEvent, splitList, type CoreWorld } from './world.js';

const HASH = 'ab'.repeat(32);

function applet(world: CoreWorld): AppletIdentity {
  return scratch(world).applet as AppletIdentity;
}

function hex(seed: string): string {
  return seed.repeat(64).slice(0, 64);
}

function relayTags(entries: string): string[][] {
  return splitList(entries).map((entry) => {
    const [url, marker] = entry.split('=') as [string, string];
    return marker ? ['r', url, marker] : ['r', url];
  });
}

function listTags(identifier: string, title: string, entries: string): string[][] {
  const tags = splitList(entries).map((entry) => entry.split(':') as [string, string]);
  if (identifier) tags.unshift(['d', identifier]);
  if (title) tags.unshift(['title', title]);
  return tags;
}

function expectLines(lines: readonly ConsentSummary['lines'][number][], table: DataTable): void {
  const expected = table.hashes().map((row) => ({
    label: row.label,
    ...(row.before ? { before: row.before } : {}),
    ...(row.after ? { after: row.after } : {}),
  }));
  expect(lines).toEqual(expected);
}

Given('the applet asking is {string}', (world: CoreWorld, dTag: string) => {
  scratch(world).applet = { dTag, hash: HASH };
});

Given('the current profile is {string}', async (world: CoreWorld, content: string) => {
  scratch(world).before = await signEvent({ kind: 0, content });
});

Given('the current follow list follows {string}', async (world: CoreWorld, seeds: string) => {
  scratch(world).before = await signEvent({ kind: 3, tags: splitList(seeds).map((seed) => ['p', hex(seed)]) });
});

Given('the current relay list is {string}', async (world: CoreWorld, entries: string) => {
  scratch(world).before = await signEvent({ kind: 10002, tags: relayTags(entries) });
});

Given('the current list has entries {string}', async (world: CoreWorld, entries: string) => {
  scratch(world).before = await signEvent({ kind: 30000, tags: listTags('friends', 'Friends', entries) });
});

function describe(world: CoreWorld, event: NostrEvent): void {
  scratch(world).summary = describeChange(event, scratch(world).before as NostrEvent | undefined, applet(world));
}

When('the shell describes signing a kind {int} event with content {string}', async (world: CoreWorld, kind: number, content: string) => {
  describe(world, await signEvent({ kind, content }));
});

When('the shell describes signing a kind {int} event with {int} characters of content', async (world: CoreWorld, kind: number, length: number) => {
  describe(world, await signEvent({ kind, content: 'x'.repeat(length) }));
});

When('the shell describes signing a kind 3 event following {string}', async (world: CoreWorld, seeds: string) => {
  describe(world, await signEvent({ kind: 3, tags: splitList(seeds).map((seed) => ['p', hex(seed)]) }));
});

When('the shell describes signing a kind 5 event deleting {string}', async (world: CoreWorld, seeds: string) => {
  describe(world, await signEvent({ kind: 5, tags: splitList(seeds).map((seed) => ['e', hex(seed)]) }));
});

When('the shell describes signing a kind 10002 event with relays {string}', async (world: CoreWorld, entries: string) => {
  describe(world, await signEvent({ kind: 10002, tags: relayTags(entries) }));
});

When('the shell describes signing a kind {int} list {string} titled {string} with entries {string}', async (world: CoreWorld, kind: number, identifier: string, title: string, entries: string) => {
  describe(world, await signEvent({ kind, tags: listTags(identifier, title, entries) }));
});

function summary(world: CoreWorld): ConsentSummary {
  return scratch(world).summary as ConsentSummary;
}

Then('the summary is {string} titled {string}', (world: CoreWorld, severity: string, title: string) => {
  expect(summary(world).severity).toBe(severity);
  expect(summary(world).title).toBe(title);
  expect(summary(world).applet).toEqual(applet(world));
});

Then('the summary lines are:', (world: CoreWorld, table: DataTable) => {
  expectLines(summary(world).lines, table);
});

Then('the summary preview is {int} characters long and ends with {string}', (world: CoreWorld, length: number, suffix: string) => {
  const preview = summary(world).lines[0]?.after ?? '';
  expect(preview).toHaveLength(length);
  expect(preview.endsWith(suffix)).toBe(true);
});

interface HandlerScratch {
  prompts: ConsentPrompt[];
  answers: boolean[];
  handle: (request: ConsentRequest) => void;
}

function handler(world: CoreWorld): HandlerScratch {
  return scratch(world).handler as HandlerScratch;
}

function installHandler(world: CoreWorld, store: EventStore): void {
  const prompts: ConsentPrompt[] = [];
  const windows = new Map([['w1', applet(world)]]);
  const handle = createConsentHandler({ presentConsent: (prompt) => void prompts.push(prompt) }, lookupReplaceable(store), (windowId) => windows.get(windowId));
  scratch(world).handler = { prompts, answers: [], handle } satisfies HandlerScratch;
}

Given('a consent handler with a store holding the current profile {string}', async (world: CoreWorld, content: string) => {
  const store = new EventStore();
  store.add(await signEvent({ kind: 0, content }));
  installHandler(world, store);
});

Given('a consent handler with a store holding a kind {int} list {string} with entries {string}', async (world: CoreWorld, kind: number, identifier: string, entries: string) => {
  const store = new EventStore();
  store.add(await signEvent({ kind, tags: listTags(identifier, '', entries) }));
  installHandler(world, store);
});

Given('a consent handler with an empty store', (world: CoreWorld) => {
  installHandler(world, new EventStore());
});

function request(world: CoreWorld, windowId: string, event: NostrEvent | undefined, type?: ConsentRequest['type']): void {
  const scratchpad = handler(world);
  const base: ConsentRequest = { windowId, pubkey: event?.pubkey ?? '', resolve: (allowed) => void scratchpad.answers.push(allowed) };
  if (event) base.event = event;
  if (type) base.type = type;
  scratchpad.handle(base);
}

When('kehto requests consent from window {string} to sign a kind {int} event with content {string}', async (world: CoreWorld, windowId: string, kind: number, content: string) => {
  request(world, windowId, await signEvent({ kind, content }));
});

When('kehto requests consent from window {string} to sign a kind {int} list {string} with entries {string}', async (world: CoreWorld, windowId: string, kind: number, identifier: string, entries: string) => {
  request(world, windowId, await signEvent({ kind, tags: listTags(identifier, '', entries) }));
});

When('kehto requests firewall consent from window {string}', (world: CoreWorld, windowId: string) => {
  request(world, windowId, undefined, 'firewall-policy');
});

Then('the host was asked {string} for applet {string}', (world: CoreWorld, title: string, dTag: string) => {
  const prompt = handler(world).prompts.at(-1);
  expect(prompt?.summary.title).toBe(title);
  expect(prompt?.summary.applet.dTag).toBe(dTag);
});

Then('the asked summary lines are:', (world: CoreWorld, table: DataTable) => {
  const prompt = handler(world).prompts.at(-1);
  expectLines(prompt?.summary.lines ?? [], table);
});

Then('the host was not asked', (world: CoreWorld) => {
  expect(handler(world).prompts).toEqual([]);
});

When('the host answers true', (world: CoreWorld) => {
  handler(world).prompts.at(-1)?.resolve(true);
});

Then('kehto received true', (world: CoreWorld) => {
  expect(handler(world).answers.at(-1)).toBe(true);
});

Then('kehto received false', (world: CoreWorld) => {
  expect(handler(world).answers.at(-1)).toBe(false);
});
