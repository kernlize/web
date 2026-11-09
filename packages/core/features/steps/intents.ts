import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import { PrivateKeySigner } from 'applesauce-signers';
import {
  catalogIdForRef,
  createHandlerDefaults,
  createInstalledApplets,
  createRelayTiers,
  parseHandlerPreferences,
  preferenceTemplate,
  preferredHandlers,
  refForCatalogId,
  type HandlerDefaults,
  type HandlerPreferences,
} from '@kernlize/core';
import type { EventTemplate, NostrEvent } from '@napplet/core';
import { appletId, i, idOfNotation, nameOf, notationOf, refOf, summaryFor, titleOf } from './intent-world.js';
import { author, scratch, splitList, type CoreWorld } from './world.js';

// ── installed set ────────────────────────────────────────────────────────

Given('an intent store', (world: CoreWorld) => {
  i(world);
});

When('the user installs {string} taking {string} requests {string}', (world: CoreWorld, name: string, role: string, conventions: string) => {
  const contracts = splitList(conventions).map((convention) => ({ slug: role, convention, params: [] }));
  i(world).installed.install(summaryFor(name, contracts));
});

When('the user installs {string} with raw contracts {string}', (world: CoreWorld, name: string, raw: string) => {
  const contracts = splitList(raw).map((part) => {
    const [slug = '', convention = ''] = part.split('>');
    return { slug, convention, params: [] };
  });
  i(world).installed.install(summaryFor(name, contracts));
});

When('the clock moves on', (world: CoreWorld) => {
  i(world).clock += 500;
});

When('the user removes {string}', (world: CoreWorld, name: string) => {
  i(world).installed.remove(appletId(name));
});

When('the intent store is reloaded', (world: CoreWorld) => {
  i(world).installed = createInstalledApplets(scratch(world).storage);
});

When('the stored installed list is {string}', (world: CoreWorld, raw: string) => {
  scratch(world).storage.setItem('kernl:installed:v1', raw);
});

Then('the installed applets are {string}', (world: CoreWorld, names: string) => {
  expect(i(world).installed.list().map((applet) => nameOf(applet.catalogId))).toEqual(splitList(names));
});

Then('{string} was installed at the first time', (world: CoreWorld, name: string) => {
  expect(i(world).installed.get(appletId(name))?.installedAt).toBe(1000);
});

Then('the intent catalogue offers {string} for role {string} with conventions {string}', (world: CoreWorld, name: string, role: string, conventions: string) => {
  const entry = i(world).installed.catalog().find((candidate) => candidate.id === appletId(name));
  expect(entry?.title).toBe(titleOf(name));
  expect(entry?.archetypes[role]?.contracts.map((contract) => contract.convention)).toEqual(splitList(conventions));
});

Then('the intent catalogue is empty', (world: CoreWorld) => {
  expect(i(world).installed.catalog()).toEqual([]);
});

// ── preferences ─────────────────────────────────────────────────────────

Then('the reference {string} is catalogue id {string}', (_world: CoreWorld, ref: string, id: string) => {
  expect(catalogIdForRef(ref)).toBe(id);
  expect(refForCatalogId(id)).toBe(ref);
});

Then('{string} is neither a reference nor a catalogue id', (_world: CoreWorld, value: string) => {
  expect(catalogIdForRef(value)).toBeUndefined();
  expect(refForCatalogId(value)).toBeUndefined();
});

Given('a handler preference event for {string} with tags:', async (world: CoreWorld, archetype: string, table: DataTable) => {
  const tags = [['d', archetype]];
  for (const row of table.hashes() as Array<{ tag: string; value: string; extra: string }>) {
    const value = row.tag === 'i' ? row.value : refOf(row.value);
    const extra = row.tag === 'i' ? refOf(row.extra) : row.extra;
    if (row.value === '-') tags.push([row.tag]);
    else tags.push(extra === '' ? [row.tag, value] : [row.tag, value, extra]);
  }
  i(world).preference = await author.signEvent({ kind: 31129, tags, content: 'sealed', created_at: 1_700_000_000 });
});

function preferences(world: CoreWorld): HandlerPreferences | undefined {
  return parseHandlerPreferences(i(world).preference as NostrEvent);
}

Then('the preferences for {string} list handlers {string}', (world: CoreWorld, archetype: string, handlers: string) => {
  expect(preferences(world)?.archetype).toBe(archetype);
  expect(preferences(world)?.handlers).toEqual(splitList(handlers).map(refOf));
});

Then('the preferences for {string} list {string} handlers {string}', (world: CoreWorld, _archetype: string, convention: string, handlers: string) => {
  expect(preferences(world)?.intents[convention]).toEqual(splitList(handlers).map(refOf));
  expect(Object.keys(preferences(world)?.intents ?? {})).toEqual([convention]);
});

Then('the preferred handlers for {string} are {string}', (world: CoreWorld, convention: string, handlers: string) => {
  expect(preferredHandlers(preferences(world), convention)).toEqual(splitList(handlers).map(idOfNotation));
});

Then('a kind 1 event is not a handler preference', async () => {
  expect(parseHandlerPreferences(await author.signEvent({ kind: 1, tags: [['d', 'profile']], content: '', created_at: 1 }))).toBeUndefined();
});

Then('a preference event without an archetype is not a handler preference', async () => {
  expect(parseHandlerPreferences(await author.signEvent({ kind: 31129, tags: [], content: '', created_at: 1 }))).toBeUndefined();
});

Then('with no preferences nothing is preferred', () => {
  expect(preferredHandlers(undefined, 'napplet:profile/open')).toEqual([]);
});

When('the shell writes {string} as the preference for {string}', (world: CoreWorld, notation: string, archetype: string) => {
  i(world).written = preferenceTemplate(i(world).preference, archetype, idOfNotation(notation), 1_800_000_000);
});

When('the shell writes {string} as the preference for {string} with nothing before', (world: CoreWorld, notation: string, archetype: string) => {
  i(world).written = preferenceTemplate(undefined, archetype, idOfNotation(notation), 1_800_000_000);
});

const describeTags = (tags: readonly (readonly string[])[]): string[] =>
  tags.map((tag) => `${tag[0]}:${tag[0] === 'd' || tag[0] === 'i' ? tag[1] : notationOf(catalogIdForRef(tag[1] as string) ?? '')}`);

Then('the written preference tags are {string} with the old content', (world: CoreWorld, tags: string) => {
  expect(describeTags(i(world).written?.tags ?? [])).toEqual(splitList(tags));
  expect(i(world).written).toMatchObject({ kind: 31129, created_at: 1_800_000_000, content: 'sealed' });
});

Then('the written preference tags are {string} with empty content', (world: CoreWorld, tags: string) => {
  expect(describeTags(i(world).written?.tags ?? [])).toEqual(splitList(tags));
  expect(i(world).written?.content).toBe('');
});

Then('a preference cannot be written for {string}', (_world: CoreWorld, id: string) => {
  expect(preferenceTemplate(undefined, 'profile', id, 1)).toBeUndefined();
});

// ── defaults ────────────────────────────────────────────────────────────

function makeDefaults(world: CoreWorld): HandlerDefaults {
  const state = i(world);
  const defaults = createHandlerDefaults({
    storage: scratch(world).storage,
    pool: scratch(world).pool,
    tiers: createRelayTiers(scratch(world).storage),
    pubkey: () => state.account.pubkey,
    signer: () => (state.account.canSign ? (template: EventTemplate) => author.signEvent(template) as Promise<NostrEvent> : undefined),
    now: () => 1_800_000_000,
  });
  defaults.changes$.subscribe((archetype) => state.heard.push(archetype));
  state.defaults = defaults;
  return defaults;
}

function defaults(world: CoreWorld): HandlerDefaults {
  const value = i(world).defaults;
  if (!value) throw new Error('make defaults first');
  return value;
}

Given('handler defaults for a signed-in account that can sign', async (world: CoreWorld) => {
  i(world).account = { pubkey: await author.getPublicKey(), canSign: true };
  makeDefaults(world);
});

Given('handler defaults for a read-only account', async (world: CoreWorld) => {
  i(world).account = { pubkey: await author.getPublicKey(), canSign: false };
  makeDefaults(world);
});

Given('relays refuse publishes', (world: CoreWorld) => {
  scratch(world).pool.publishOk = false;
});

When('the user makes {string} the default for {string}', async (world: CoreWorld, notation: string, archetype: string) => {
  await defaults(world).set(archetype, idOfNotation(notation));
});

When('the user forgets the default for {string}', async (world: CoreWorld, archetype: string) => {
  await defaults(world).set(archetype, undefined);
});

When('the handler defaults are reloaded', (world: CoreWorld) => {
  makeDefaults(world);
});

When('the user turns sharing on', (world: CoreWorld) => {
  defaults(world).setSync(true);
});

When('the user turns sharing off', (world: CoreWorld) => {
  defaults(world).setSync(false);
});

Then('the default for {string} is {string}', (world: CoreWorld, archetype: string, expected: string) => {
  const value = i(world).router ? i(world).local.get(archetype) : defaults(world).get(archetype);
  expect(i(world).router ? nameOf(value ?? '') : notationOf(value ?? '')).toBe(expected);
});

Then('the defaults are {string}', (world: CoreWorld, expected: string) => {
  expect(Object.entries(defaults(world).all()).map(([archetype, id]) => `${archetype}=${notationOf(id)}`)).toEqual(splitList(expected));
});

Then('no preference was published', (world: CoreWorld) => {
  expect(scratch(world).pool.calls.filter((call) => call.method === 'publish')).toEqual([]);
});

Then('the default changes heard were {string}', (world: CoreWorld, archetypes: string) => {
  expect(i(world).heard).toEqual(splitList(archetypes));
});

Then('the last published preference for {string} lists {string} on {string}', (world: CoreWorld, archetype: string, tags: string, relays: string) => {
  const call = scratch(world).pool.calls.filter((entry) => entry.method === 'publish').at(-1);
  expect(call?.relays).toEqual(splitList(relays));
  expect(call?.event?.tags[0]).toEqual(['d', archetype]);
  expect(describeTags(call?.event?.tags.slice(1) ?? [])).toEqual(splitList(tags));
});

Then('sharing is on after a reload', (world: CoreWorld) => {
  expect(defaults(world).sync).toBe(true);
  expect(makeDefaults(world).sync).toBe(true);
});

Then('sharing is off after a reload', (world: CoreWorld) => {
  expect(makeDefaults(world).sync).toBe(false);
});

async function preferenceEvent(signer: { signEvent: typeof author.signEvent }, archetype: string, at: number, notation: string): Promise<NostrEvent> {
  return signer.signEvent({ kind: 31129, tags: [['d', archetype], ['a', refOf(notation)]], content: '', created_at: at });
}

Given('the account published preferences {string}', async (world: CoreWorld, specs: string) => {
  for (const spec of splitList(specs)) {
    const [head = '', ...rest] = spec.split(':');
    const [archetype = '', at = '0'] = head.split('@');
    scratch(world).pool.events.push(await preferenceEvent(author, archetype, Number(at), rest.join(':')));
  }
});

Given('someone else published a preference for {string}', async (world: CoreWorld, archetype: string) => {
  scratch(world).pool.events.push(await preferenceEvent(new PrivateKeySigner(), archetype, 9, 'named:stranger'));
});

Given('a forged preference for {string} is on the relays', async (world: CoreWorld, archetype: string) => {
  const real = await preferenceEvent(author, archetype, 10, 'named:viewer');
  const copy = JSON.parse(JSON.stringify(real)) as NostrEvent;
  scratch(world).pool.events.push({ ...copy, tags: [['d', archetype], ['a', refOf('named:forged')]] });
  scratch(world).pool.events.push(await author.signEvent({ kind: 1, tags: [['d', archetype]], content: '', created_at: 11 }));
  scratch(world).pool.events.push(await author.signEvent({ kind: 31129, tags: [], content: '', created_at: 12 }));
});

When("the handler defaults load the account's preferences", async (world: CoreWorld) => {
  await defaults(world).load();
});

When('the account signs out', (world: CoreWorld) => {
  i(world).account = { pubkey: undefined, canSign: false };
});

Given('the account signs back in', async (world: CoreWorld) => {
  i(world).account = { pubkey: await author.getPublicKey(), canSign: true };
});

Then('the published preferences for {string} list handlers {string}', (world: CoreWorld, archetype: string, handlers: string) => {
  expect(defaults(world).synced(archetype)?.handlers).toEqual(splitList(handlers).map(refOf));
});

Then('there are no published preferences for {string}', (world: CoreWorld, archetype: string) => {
  expect(defaults(world).synced(archetype)).toBeUndefined();
});

Then("the preference request asked for the account's kind 31129 events", async (world: CoreWorld) => {
  const request = scratch(world).pool.calls.filter((call) => call.method === 'request').at(-1);
  expect(request?.filters).toEqual([{ kinds: [31129], authors: [await author.getPublicKey()] }]);
});

