import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { Observable } from 'rxjs';
import { decodeAddressPointer, decodeEventPointer } from 'applesauce-core/helpers';
import {
  addressOf,
  createRelayTiers,
  fuzzyScore,
  loadCatalog,
  newestEntries,
  popularTopics,
  searchCatalog,
  toCatalogEntry,
  type CatalogEntry,
  type CatalogQuery,
} from '@kernlize/core';
import type { NostrEvent } from '@napplet/core';
import { author, scratch, sha256Hex, signManifest, splitList, type CoreWorld } from './world.js';

interface CatalogScratch {
  event?: NostrEvent;
  entry?: CatalogEntry | undefined;
  entries: readonly CatalogEntry[];
  publisher?: string;
}

const ICON_HASH = 'ab'.repeat(32);

function c(world: CoreWorld): CatalogScratch {
  const store = scratch(world);
  store.catalog ??= { entries: [] } satisfies CatalogScratch;
  return store.catalog as CatalogScratch;
}

function manifestEvent(world: CoreWorld): NostrEvent {
  const event = c(world).event;
  if (!event) throw new Error('make a manifest first');
  return event;
}

function entry(world: CoreWorld): CatalogEntry {
  const value = c(world).entry;
  if (!value) throw new Error('read a manifest first');
  return value;
}

async function signedManifests(specs: string): Promise<NostrEvent[]> {
  const events: NostrEvent[] = [];
  for (const spec of splitList(specs)) {
    const [dTag = '', at = '0'] = spec.split('@');
    events.push((await signManifest({ dTag, title: dTag, createdAt: Number(at) })).event);
  }
  return events;
}

Given('a catalogue manifest {string} titled {string} with topics {string} requiring {string} and an icon on {string}', async (world: CoreWorld, dTag: string, title: string, topics: string, requires: string, server: string) => {
  const extraTags = [...splitList(topics).map((topic) => ['t', topic]), ['t', '  '], ['icon', ICON_HASH, 'image/png']];
  c(world).event = (await signManifest({ dTag, title, requires: splitList(requires), servers: [server], extraTags })).event;
});

Given('a catalogue manifest {string} titled {string} taking {string} requests {string}', async (world: CoreWorld, dTag: string, title: string, role: string, conventions: string) => {
  const extraTags = [['z', role], ...splitList(conventions).map((convention) => ['i', convention]), ['icon', ICON_HASH, 'image/png']];
  c(world).event = (await signManifest({ dTag, title, extraTags })).event;
});

Given('a root catalogue manifest without a title', async (world: CoreWorld) => {
  const html = '<!doctype html><title>root</title>';
  c(world).event = await author.signEvent({ kind: 15129, tags: [['x', sha256Hex(html)], ['R', 'relay']], content: 'A root applet.', created_at: 1_700_000_000 });
});

Given('a legacy catalogue manifest {string} taking {string} without a title or description', async (world: CoreWorld, dTag: string, convention: string) => {
  const hash = 'ab'.repeat(32);
  const [, role = ''] = /^napplet:([^/]+)\//.exec(convention) ?? [];
  const tags = [['d', dTag], ['x', hash, 'aggregate'], ['path', '/index.html', hash], ['requires', 'relay'], ['archetype', role, convention]];
  c(world).event = await author.signEvent({ kind: 35129, tags, content: '', created_at: 1_700_000_000 });
});

Given('a snapshot catalogue manifest', async (world: CoreWorld) => {
  c(world).event = (await signManifest({ kind: 5129 })).event;
});

Given('a catalogue manifest that is signed by someone else', async (world: CoreWorld) => {
  const { event } = await signManifest({ dTag: 'forged' });
  c(world).event = fromRelay(event, { pubkey: 'f'.repeat(64) });
});

Given('a catalogue manifest that is missing its hash', async (world: CoreWorld) => {
  c(world).event = await author.signEvent({ kind: 35129, tags: [['d', 'nohash'], ['title', 'No hash']], content: '', created_at: 1_700_000_000 });
});

When('the catalogue reads that manifest found on {string}', (world: CoreWorld, relays: string) => {
  c(world).entry = toCatalogEntry(manifestEvent(world), splitList(relays));
});

Then('the catalogue entry is titled {string} with topics {string} and requires {string}', (world: CoreWorld, title: string, topics: string, requires: string) => {
  expect(entry(world).title).toBe(title);
  expect(entry(world).topics).toEqual(splitList(topics));
  expect(entry(world).requires).toEqual(splitList(requires));
  expect(entry(world).publisher).toBe(manifestEvent(world).pubkey);
  expect(entry(world).publishedAt).toBe(manifestEvent(world).created_at);
});

Then('the catalogue entry address decodes to the manifest coordinate with relay {string}', (world: CoreWorld, relay: string) => {
  const pointer = decodeAddressPointer(entry(world).address);
  expect(pointer).toMatchObject({ kind: 35129, pubkey: manifestEvent(world).pubkey, identifier: 'minesweeper', relays: [relay] });
});

Then('the catalogue entry address is a shareable address', (world: CoreWorld) => {
  expect(decodeAddressPointer(entry(world).address)).toMatchObject({ kind: 15129, identifier: '' });
});

Then('the catalogue entry icon is the icon hash on {string}', (world: CoreWorld, server: string) => {
  expect(entry(world).iconUrl).toBe(`${server}/${ICON_HASH}`);
});

Then('the catalogue entry has no description', (world: CoreWorld) => {
  expect(entry(world).description).toBe('');
});

Then('the catalogue entry has no icon', (world: CoreWorld) => {
  expect(entry(world).iconUrl).toBeUndefined();
});

Then("the catalogue entry catalogue id is kehto's for {string}", (world: CoreWorld, dTag: string) => {
  expect(entry(world).catalogId).toBe(`nip5d:35129:${manifestEvent(world).pubkey}:${dTag}`);
});

Then('the catalogue entry takes roles {string} and conventions {string}', (world: CoreWorld, roles: string, conventions: string) => {
  expect(entry(world).archetypes).toEqual(splitList(roles));
  expect(entry(world).conventions).toEqual(splitList(conventions));
});

Then("the snapshot's address decodes to its event id", (world: CoreWorld) => {
  const event = manifestEvent(world);
  expect(decodeEventPointer(addressOf(event))).toMatchObject({ id: event.id, author: event.pubkey, kind: 5129 });
});

Then('the catalogue has no entry', (world: CoreWorld) => {
  expect(c(world).entry).toBeUndefined();
});

/** A copy as a relay would deliver it: plain JSON, without the signer's cached verification mark. */
const fromRelay = (event: NostrEvent, change: Partial<NostrEvent>): NostrEvent => ({ ...(JSON.parse(JSON.stringify(event)) as NostrEvent), ...change });

/** `chat@3` is an entry for applet "chat" published at time 3. */
function fakeEntry(spec: string, extra: Partial<CatalogEntry> = {}): CatalogEntry {
  const [name = '', at = '0'] = spec.split('@');
  return {
    catalogId: `nip5d:35129:${'a'.repeat(64)}:${name}`,
    address: `naddr-${name}`,
    kind: 35129,
    publisher: 'a'.repeat(64),
    title: name,
    description: '',
    topics: [],
    requires: [],
    archetypes: [],
    conventions: [],
    publishedAt: Number(at),
    ...extra,
  };
}

const describeEntries = (entries: readonly CatalogEntry[]): string[] => entries.map((value) => `${value.title}@${value.publishedAt}`);

Given('catalogue entries {string}', (world: CoreWorld, specs: string) => {
  c(world).entries = splitList(specs).map((spec) => fakeEntry(spec));
});

When('the catalogue keeps the newest of each', (world: CoreWorld) => {
  c(world).entries = newestEntries(c(world).entries);
});

Then('the catalogue lists {string}', (world: CoreWorld, specs: string) => {
  expect(describeEntries(c(world).entries)).toEqual(splitList(specs));
});

Given('the fake pool serves catalogue manifests {string}', async (world: CoreWorld, specs: string) => {
  scratch(world).pool.events = await signedManifests(specs);
  c(world).publisher = await author.getPublicKey();
});

Given('the fake pool serves catalogue manifests {string} and a forged one', async (world: CoreWorld, specs: string) => {
  const forged = (await signManifest({ dTag: 'forged', title: 'forged', createdAt: 9 })).event;
  scratch(world).pool.events = [...(await signedManifests(specs)), fromRelay(forged, { content: 'tampered' })];
});

Given('the fake pool serves catalogue manifests {string} and then never finishes', async (world: CoreWorld, specs: string) => {
  const events = await signedManifests(specs);
  const pool = scratch(world).pool;
  pool.request = (() => new Observable<NostrEvent>((observer) => events.forEach((event) => observer.next(event)))) as typeof pool.request;
});

When("the catalogue loads from the shell's relays waiting {int} ms", async (world: CoreWorld, timeoutMs: number) => {
  c(world).entries = await loadCatalog(scratch(world).pool, createRelayTiers(scratch(world).storage), { timeoutMs });
});

When("the catalogue loads from the shell's relays", async (world: CoreWorld) => {
  c(world).entries = await loadCatalog(scratch(world).pool, createRelayTiers(scratch(world).storage));
});

When('the catalogue loads {int} manifests from the test publisher', async (world: CoreWorld, limit: number) => {
  c(world).entries = await loadCatalog(scratch(world).pool, createRelayTiers(scratch(world).storage), { limit, publishers: [c(world).publisher as string] });
});

Then('the catalogue asked {string} for named and root manifests limited to {int}', (world: CoreWorld, relays: string, limit: number) => {
  const [call] = scratch(world).pool.calls;
  expect(call?.relays).toEqual(splitList(relays));
  expect(call?.filters).toEqual([{ kinds: [35129, 15129], limit }]);
});

Then('the catalogue asked for {int} manifests from the test publisher', (world: CoreWorld, limit: number) => {
  const [call] = scratch(world).pool.calls;
  expect(call?.filters).toEqual([{ kinds: [35129, 15129], limit, authors: [c(world).publisher] }]);
  expect(describeEntries(c(world).entries)).toEqual(['solo@1']);
});

Then('the search score of {string} in {string} is {int}', (_world: CoreWorld, word: string, field: string, score: number) => {
  expect(fuzzyScore(word, field)).toBe(score);
});

Given('a searchable catalogue', (world: CoreWorld) => {
  c(world).entries = [
    fakeEntry('Chess@4', { description: 'Play on a board against a friend.', topics: ['game'], requires: ['storage'] }),
    fakeEntry('Puzzle Box@3', { description: 'Chess problems and other puzzles', topics: ['game', 'puzzle'], requires: ['storage'] }),
    fakeEntry('Notepad@2', { description: 'Write plain text', topics: ['writing'], archetypes: ['text-editor'], conventions: ['napplet:text-editor/open'], requires: ['relay'] }),
    fakeEntry('Bitmap@1', { description: 'Draw pixels', topics: ['art'], requires: ['fs'] }),
  ];
});

function search(world: CoreWorld, query: CatalogQuery): string[] {
  return searchCatalog(c(world).entries, query).map((value) => value.title);
}

Then('searching {string} finds {string}', (world: CoreWorld, text: string, titles: string) => {
  expect(search(world, { text })).toEqual(splitList(titles));
});

Then('searching the publisher finds every entry', (world: CoreWorld) => {
  expect(search(world, { text: 'a'.repeat(64) })).toHaveLength(4);
  expect(searchCatalog(c(world).entries)).toHaveLength(4);
});

Then('searching {string} with topics {string} finds {string}', (world: CoreWorld, text: string, topics: string, titles: string) => {
  expect(search(world, { text, topics: splitList(topics) })).toEqual(splitList(titles));
});

Then('searching {string} with the shell offering {string} finds {string}', (world: CoreWorld, text: string, domains: string, titles: string) => {
  expect(search(world, { text, available: splitList(domains) })).toEqual(splitList(titles));
});

Then('searching {string} accepting {string} finds {string}', (world: CoreWorld, text: string, convention: string, titles: string) => {
  expect(search(world, { text, convention })).toEqual(splitList(titles));
});

const describeTopics = (topics: readonly { topic: string; count: number }[]): string[] => topics.map(({ topic, count }) => `${topic}:${count}`);

Then('the popular topics are {string}', (world: CoreWorld, topics: string) => {
  expect(describeTopics(popularTopics(c(world).entries))).toEqual(splitList(topics));
});

Then('the {int} most popular topics are {string}', (world: CoreWorld, limit: number, topics: string) => {
  expect(describeTopics(popularTopics(c(world).entries, limit))).toEqual(splitList(topics));
});
