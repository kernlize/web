import { expect, vi } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { EventStore } from 'applesauce-core';
import type { AddressPointerLoader, LoadableAddressPointer } from 'applesauce-loaders/loaders';
import type { ConsentRequest } from '@kehto/runtime';
import type { NostrEvent } from '@napplet/core';
import {
  createConsentHandler,
  describeChange,
  isDestructiveKind,
  lookupReplaceable,
  type AppletIdentity,
  type ConsentPrompt,
  type ConsentSummary,
  type LookupReplaceableOptions,
} from '@kernlize/core';
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

When('the shell describes signing a kind 5 event deleting {string} and addresses {string}', async (world: CoreWorld, seeds: string, addresses: string) => {
  const ids = splitList(seeds).map((seed) => ['e', hex(seed)]);
  const coordinates = splitList(addresses).map((address) => {
    const [kind, seed, identifier] = address.split(':') as [string, string, string];
    return ['a', `${kind}:${hex(seed)}:${identifier}`];
  });
  describe(world, await signEvent({ kind: 5, tags: [...ids, ...coordinates] }));
});

When('the shell describes signing a kind 62 request naming services {string}', async (world: CoreWorld, services: string) => {
  describe(world, await signEvent({ kind: 62, tags: splitList(services).map((url) => ['relay', url]) }));
});

async function record(kind: number, identifier: string, content: string, entries: string): Promise<NostrEvent> {
  return signEvent({ kind, content, tags: listTags(identifier, '', entries) });
}

Given('the current kind {int} record {string} has content {string} and entries {string}', async (world: CoreWorld, kind: number, identifier: string, content: string, entries: string) => {
  scratch(world).before = await record(kind, identifier, content, entries);
});

When('the shell describes signing a kind {int} record {string} with content {string} and entries {string}', async (world: CoreWorld, kind: number, identifier: string, content: string, entries: string) => {
  describe(world, await record(kind, identifier, content, entries));
});

/** `a=viewer` prefers the named applet "viewer"; `e=pinned` a pinned version; `r=` a root applet; `i=<convention>>name` an intent-specific choice. */
function preferenceTags(archetype: string, entries: string): string[][] {
  const named = (name: string): string => (name === '' ? `15129:${hex('c')}:` : `35129:${hex('c')}:${name}`);
  const tags = splitList(entries).map((entry) => {
    const [tag = '', value = ''] = entry.split('=');
    if (tag === 'e') return ['e', hex(value.charAt(0))];
    if (tag === 'i') {
      const [convention = '', name = ''] = value.split('>');
      return name === '?' ? ['i', convention] : ['i', convention, named(name)];
    }
    return tag === 'r' ? ['a', named('')] : [tag, named(value)];
  });
  return [['d', archetype], ...tags];
}

Given('the current handler preferences for {string} are {string}', async (world: CoreWorld, archetype: string, entries: string) => {
  scratch(world).before = await signEvent({ kind: 31129, tags: preferenceTags(archetype, entries), content: '' });
});

When('the shell describes an applet setting the handler preferences for {string} to {string} with private choices', async (world: CoreWorld, archetype: string, entries: string) => {
  describe(world, await signEvent({ kind: 31129, tags: preferenceTags(archetype, entries), content: 'sealed' }));
});

When('the shell describes an applet setting handler preferences without an archetype to {string}', async (world: CoreWorld, entries: string) => {
  describe(world, await signEvent({ kind: 31129, tags: preferenceTags('', entries).slice(1), content: '' }));
});

Then('kinds {string} are destructive', (_world: CoreWorld, kinds: string) => {
  expect(splitList(kinds).filter((kind) => !isDestructiveKind(Number(kind)))).toEqual([]);
});

Then('kinds {string} are routine', (_world: CoreWorld, kinds: string) => {
  expect(splitList(kinds).filter((kind) => isDestructiveKind(Number(kind)))).toEqual([]);
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
  asked: LoadableAddressPointer[];
}

function handler(world: CoreWorld): HandlerScratch {
  return scratch(world).handler as HandlerScratch;
}

/** How long the never-answering network is given before the lookup gives up, so scenarios stay fast. */
const SHORT_TIMEOUT_MS = 20;

function installHandler(world: CoreWorld, store: EventStore, network?: (pointer: LoadableAddressPointer) => Observable<NostrEvent>): void {
  const prompts: ConsentPrompt[] = [];
  const asked: LoadableAddressPointer[] = [];
  const windows = new Map([['w1', applet(world)]]);
  let options: LookupReplaceableOptions = {};
  if (network) {
    const loader = ((pointer: LoadableAddressPointer) => {
      asked.push(pointer);
      return network(pointer);
    }) as AddressPointerLoader;
    options = { loader, timeoutMs: SHORT_TIMEOUT_MS };
  }
  const handle = createConsentHandler({ presentConsent: (prompt) => void prompts.push(prompt) }, lookupReplaceable(store, options), (windowId) => windows.get(windowId));
  scratch(world).handler = { prompts, answers: [], handle, asked } satisfies HandlerScratch;
}

Given('a consent handler with an empty store and a network holding follow lists {string} then {string}', async (world: CoreWorld, older: string, newer: string) => {
  const follows = (seeds: string, created_at: number) => signEvent({ kind: 3, created_at, tags: splitList(seeds).map((seed) => ['p', hex(seed)]) });
  const versions = [await follows(newer, 1_700_000_100), await follows(older, 1_700_000_000)];
  installHandler(world, new EventStore(), () => of(...versions));
});

Given('a consent handler with an empty store and a network that never answers', (world: CoreWorld) => {
  installHandler(world, new EventStore(), () => NEVER);
});

Given('a consent handler with an empty store and a network that fails', (world: CoreWorld) => {
  installHandler(world, new EventStore(), () => throwError(() => new Error('relay down')));
});

Then('the network was asked for kind {int} with no identifier', (world: CoreWorld, kind: number) => {
  const pointer = handler(world).asked.at(-1);
  expect(pointer?.kind).toBe(kind);
  expect(pointer && 'identifier' in pointer).toBe(false);
});

Then('the network was asked for kind {int} with identifier {string}', async (world: CoreWorld, kind: number, identifier: string) => {
  await vi.waitFor(() => expect(handler(world).asked.at(-1)).toMatchObject({ kind, identifier }));
});

Then('the network was not asked', (world: CoreWorld) => {
  expect(handler(world).asked).toEqual([]);
});

When('kehto requests consent from window {string} to sign a kind 3 event following {string}', async (world: CoreWorld, windowId: string, seeds: string) => {
  request(world, windowId, await signEvent({ kind: 3, tags: splitList(seeds).map((seed) => ['p', hex(seed)]) }));
});

async function lastPrompt(world: CoreWorld): Promise<ConsentPrompt> {
  const { prompts } = handler(world);
  await vi.waitFor(() => expect(prompts.length).toBeGreaterThan(0));
  return prompts.at(-1) as ConsentPrompt;
}

Then('the asked summary is {string}', async (world: CoreWorld, severity: string) => {
  expect((await lastPrompt(world)).summary.severity).toBe(severity);
});

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

Then('the host was asked {string} for applet {string}', async (world: CoreWorld, title: string, dTag: string) => {
  const prompt = await lastPrompt(world);
  expect(prompt.summary.title).toBe(title);
  expect(prompt.summary.applet.dTag).toBe(dTag);
});

Then('the asked summary lines are:', async (world: CoreWorld, table: DataTable) => {
  expectLines((await lastPrompt(world)).summary.lines, table);
});

Then('the host was not asked', (world: CoreWorld) => {
  expect(handler(world).prompts).toEqual([]);
});

When('the host answers true', async (world: CoreWorld) => {
  (await lastPrompt(world)).resolve(true);
});

Then('kehto received true', (world: CoreWorld) => {
  expect(handler(world).answers.at(-1)).toBe(true);
});

Then('kehto received false', (world: CoreWorld) => {
  expect(handler(world).answers.at(-1)).toBe(false);
});
