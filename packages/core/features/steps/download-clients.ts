import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { createDownloadClients, createMemorySecrets, createStorageSecrets, currentPageScheme, DOWNLOAD_PROGRAMS, type CheckedConnection, type DownloadClients, type DownloadConnection, type DownloadProgram, type RoutedDomain, type SecretsProvider } from '@kernlize/core';
import type { PageScheme } from '@kernlize/bridges';
import { startFakeTransmission, type FakeTransmission } from '../../../bridges/features/steps/fake-transmission.ts';
import { MemoryStorage, scratch, type CoreWorld } from './world.js';

interface ProgramsScratch {
  storage: MemoryStorage;
  page: PageScheme;
  settings?: DownloadClients;
  transmission?: FakeTransmission;
  checked?: CheckedConnection;
  error?: unknown;
  lastSharing?: unknown;
  carried?: number;
  /** How the provider under test misbehaves, if at all. */
  fault?: 'refuses' | 'withholds';
  /** The connection ids whose secrets a withholding provider keeps back. */
  withheld: Set<string>;
  /** Connections removed, by label, so their secrets can be looked for afterwards. */
  removed: Map<string, DownloadConnection>;
}

/** The default provider over the scenario's storage, able to refuse or withhold as a real keeper can. */
function faultySecrets(programs: ProgramsScratch): SecretsProvider {
  const real = createStorageSecrets(programs.storage);
  const withholds = (name: string): boolean => programs.fault === 'withholds' && [...programs.withheld].some((id) => name.includes(id));
  return {
    description: real.description,
    get: (name) => (withholds(name) ? Promise.reject(new Error('unavailable:secrets')) : real.get(name)),
    set: (name, value) => (programs.fault === 'refuses' ? Promise.reject(new Error('denied:secrets')) : real.set(name, value)),
    delete: (name) => real.delete(name),
  };
}

const STORAGE_KEY = 'kernl:download-programs:v1';
const DOMAIN: Readonly<Record<string, RoutedDomain>> = { torrents: 'torrent', sharing: 'soulseek' };

function state(world: CoreWorld): ProgramsScratch {
  const bag = scratch(world) as { programs?: ProgramsScratch };
  bag.programs ??= { storage: new MemoryStorage(), page: 'http', withheld: new Set(), removed: new Map() };
  return bag.programs;
}

function settings(world: CoreWorld): DownloadClients {
  const { settings: value } = state(world);
  if (!value) throw new Error('open the settings first');
  return value;
}

function labelled(world: CoreWorld, label: string): DownloadConnection {
  const found = settings(world).state().connections.find((connection) => connection.label === label);
  if (!found) throw new Error(`no connection labelled ${label}`);
  return found;
}

function fakeUrl(world: CoreWorld): string {
  const fake = state(world).transmission;
  if (!fake) throw new Error('start the Transmission program first');
  return fake.url.replace(/\/$/, '');
}

function open(world: CoreWorld): void {
  const programs = state(world);
  programs.settings = createDownloadClients({ storage: programs.storage, secrets: faultySecrets(programs), pageScheme: () => programs.page });
}

async function attempt(world: CoreWorld, run: () => unknown): Promise<void> {
  state(world).error = undefined;
  try {
    await run();
  } catch (error) {
    state(world).error = error;
  }
}

function refused(world: CoreWorld, reason: string): void {
  expect((state(world).error as Error | undefined)?.message).toBe(reason);
}

After(async (world: CoreWorld) => {
  await (scratch(world) as { programs?: ProgramsScratch }).programs?.transmission?.close();
  delete (globalThis as { location?: unknown }).location;
});

Given('a Transmission program on this device that wants {string} and {string}', async (world: CoreWorld, username: string, password: string) => {
  const fake = await startFakeTransmission();
  fake.credentials = { username, password };
  state(world).transmission = fake;
});

Given('download program settings on a page loaded over {string}', (world: CoreWorld, page: PageScheme) => {
  state(world).page = page;
  open(world);
});

Given('stored download connections holding the plain address {string}, damaged entries and a default naming no connection', (world: CoreWorld, url: string) => {
  const entry = (id: string, more: Record<string, unknown> = {}) => ({ id, program: 'sabnzbd', label: id, url, hasApiKey: false, routingKey: `${id}:0`, ...more });
  state(world).storage.setItem(STORAGE_KEY, JSON.stringify({
    connections: [
      entry('k1', { label: 'Kept', hasApiKey: true }),
      entry('k2', { program: 'slskd', label: 'Second', routingKey: 'k2:3' }),
      entry('k1', { label: 'A second k1' }),
      entry('k3', { program: 'qbittorrent' }),
      entry('k4', { routingKey: 'k5:0' }),
      entry('k6', { routingKey: 'k6:x' }),
      entry('k7', { label: '' }),
      entry('k8', { label: 'x'.repeat(61) }),
      entry('k9', { label: ' padded ' }),
      entry('../x'),
      entry('k10', { username: 12 }),
      entry('k11', { url: 7 }),
      entry('k12', { routingKey: 5 }),
      entry('k13', { url: url.replace(/^http:/, 'ftp:') }),
      'nonsense',
      null,
    ],
    defaults: { torrent: 'missing', soulseek: 'k1' },
  }));
});

When('the person checks the transmission program at its bare address as {string} with {string}', async (world: CoreWorld, username: string, password: string) => {
  const bare = new URL(fakeUrl(world)).host;
  await attempt(world, async () => {
    state(world).checked = await settings(world).check('transmission', { url: bare, username, password });
  });
});

When('the person checks the {string} connection at its bare address as {string} with {string}', async (world: CoreWorld, label: string, username: string, password: string) => {
  state(world).checked = await settings(world).check('transmission', { url: new URL(fakeUrl(world)).host, username, password }, labelled(world, label).id);
});

When('the person checks and adds the transmission program as {string} with {string}', async (world: CoreWorld, username: string, password: string) => {
  const checked = await settings(world).check('transmission', { url: new URL(fakeUrl(world)).host, username, password });
  await settings(world).add('transmission', checked.signIn);
});

When('the person tries to add the sabnzbd program at {string}', (world: CoreWorld, url: string) => attempt(world, () => settings(world).add('sabnzbd', { url, apiKey: 'k1' })));

When('the person tries to add the nzbget program with a password {int} characters long', (world: CoreWorld, length: number) =>
  attempt(world, () => settings(world).add('nzbget', { url: DOWNLOAD_PROGRAMS.nzbget.example, username: 'ann', password: 'p'.repeat(length) })));

When('the person adds the {word} program at {string} with the key {string}', async (world: CoreWorld, program: DownloadProgram, url: string, apiKey: string) => {
  await settings(world).add(program, { url, apiKey, username: '', password: '' });
});

When('the person adds the {word} program at {string} with the name {string}', async (world: CoreWorld, program: DownloadProgram, url: string, username: string) => {
  await settings(world).add(program, { url, username });
});

When('the person adds the {word} program at {string} labelled {string}', async (world: CoreWorld, program: DownloadProgram, url: string, label: string) => {
  await settings(world).add(program, { url }, label);
});

When('the person relabels {string} as {string}', async (world: CoreWorld, label: string, next: string) => {
  state(world).lastSharing = settings(world).routing('soulseek').preferred()?.client;
  await settings(world).update(labelled(world, label).id, { label: next });
});

When('the person changes {string} to {string} with the key {string}', async (world: CoreWorld, label: string, url: string, apiKey: string) => {
  state(world).lastSharing = settings(world).routing('soulseek').preferred()?.client;
  await settings(world).update(labelled(world, label).id, { signIn: { url, apiKey } });
});

When("the person changes {string} to the program's own address as {string} with {string}", async (world: CoreWorld, label: string, username: string, password: string) => {
  await settings(world).update(labelled(world, label).id, { signIn: { url: fakeUrl(world), username, password } });
});

When('the person changes {string} to {string} as {string} with {string}', async (world: CoreWorld, label: string, url: string, username: string, password: string) => {
  await settings(world).update(labelled(world, label).id, { signIn: { url, username, password } });
});

When('the person chooses {string} for {word}', (world: CoreWorld, label: string, kind: string) => settings(world).chooseDefault(DOMAIN[kind] as RoutedDomain, labelled(world, label).id));

When('the person removes the {string} connection', async (world: CoreWorld, label: string) => {
  const connection = labelled(world, label);
  state(world).removed.set(label, connection);
  await settings(world).remove(connection.id);
});

When('the person removes a connection that does not exist', (world: CoreWorld) => settings(world).remove('no-such-connection'));

Given('a secrets provider that refuses to keep anything', (world: CoreWorld) => {
  state(world).fault = 'refuses';
});

When('the secrets provider stops handing over the secrets of {string}', (world: CoreWorld, label: string) => {
  state(world).fault = 'withholds';
  state(world).withheld.add(labelled(world, label).id);
});

When('the secrets provider hands secrets over again', (world: CoreWorld) => {
  state(world).fault = undefined;
});

Given(/^a stored download programs record that reads "(.*)"$/, (world: CoreWorld, record: string) => {
  state(world).storage.setItem(STORAGE_KEY, record);
});

When("the download program settings are opened again with the host's own fetch", async (world: CoreWorld) => {
  const programs = state(world);
  programs.carried = 0;
  programs.settings = createDownloadClients({
    storage: programs.storage,
    pageScheme: () => programs.page,
    fetch: (input, init) => {
      programs.carried = (programs.carried ?? 0) + 1;
      return fetch(input, init);
    },
  });
  await programs.settings.ready;
});

Then("the host's own fetch carried the requests", (world: CoreWorld) => {
  expect(state(world).carried).toBeGreaterThan(0);
});

When('the download program settings are opened again', async (world: CoreWorld) => {
  open(world);
  await settings(world).ready;
});

Then('the checked connection is the program\'s {string} address, noted {string}', (world: CoreWorld, scheme: string, note: string) => {
  const { checked } = state(world);
  expect(checked?.signIn.url).toBe(fakeUrl(world));
  expect(checked?.signIn.url.startsWith(`${scheme}://`)).toBe(true);
  expect(checked?.notes).toEqual([note]);
});

Then('the checked program reports the version {string}', (world: CoreWorld, version: string) => {
  expect(state(world).checked?.probe.version).toBe(version);
});

Then('nothing is set up yet', (world: CoreWorld) => {
  expect(settings(world).state()).toEqual({ connections: [], defaults: {}, locked: [] });
});

Then('the download program check fails with {string}', (world: CoreWorld, reason: string) => {
  expect((state(world).error as Error).message.startsWith(reason)).toBe(true);
});

Then('adding the download connection is refused with {string}', refused);

Then('the settings hold one {string} connection called {string}, the torrent default', (world: CoreWorld, program: DownloadProgram, label: string) => {
  const seen: unknown[] = [];
  settings(world).state$.subscribe((value) => seen.push(value)).unsubscribe();
  expect(seen).toEqual([settings(world).state()]);
  const [connection, ...others] = settings(world).state().connections;
  expect(others).toEqual([]);
  expect(connection).toMatchObject({ program, label });
  expect(connection?.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(settings(world).state().defaults).toEqual({ torrent: connection?.id });
});

Then('the torrent client the services call lists {int} torrents from the real program', async (world: CoreWorld, count: number) => {
  expect(await settings(world).routing('torrent').preferred()?.client.list()).toHaveLength(count);
  expect(state(world).transmission?.calls.map((call) => call.method)).toContain('torrent-get');
});

Then('the same torrent client is kept between calls', (world: CoreWorld) => {
  const torrents = settings(world).routing('torrent');
  const [only] = torrents.all();
  expect(torrents.byId(only?.connection.id as string)?.client).toBe(torrents.preferred()?.client);
  expect(torrents.byId('no-such-connection')).toBeUndefined();
});

Then('the settings record holds the address, name and label, and no password', (world: CoreWorld) => {
  const raw = state(world).storage.getItem(STORAGE_KEY) as string;
  const [connection] = settings(world).state().connections as DownloadConnection[];
  const { id } = connection as DownloadConnection;
  expect(JSON.parse(raw)).toEqual({
    connections: [{ id, program: 'transmission', label: 'Transmission', url: fakeUrl(world), username: 'ann', hasPassword: true, hasApiKey: false, routingKey: `${id}:0` }],
    defaults: { torrent: id },
  });
  expect(raw).not.toContain('s3cret');
  expect(JSON.stringify(settings(world).state())).not.toContain('s3cret');
});

Then("the password is with the secrets provider under the connection's id", async (world: CoreWorld) => {
  expect(await createStorageSecrets(state(world).storage).get(`download:${labelled(world, 'Transmission').id}:password`)).toBe('s3cret');
});

Then('the secrets provider holds no password for {string}', async (world: CoreWorld, label: string) => {
  expect(await createStorageSecrets(state(world).storage).get(`download:${labelled(world, label).id}:password`)).toBeUndefined();
});

Then('the secrets provider holds no key for the removed {string}', async (world: CoreWorld, label: string) => {
  const removed = state(world).removed.get(label) as DownloadConnection;
  expect(await createStorageSecrets(state(world).storage).get(`download:${removed.id}:apiKey`)).toBeUndefined();
});

Then(/^the "([^"]*)" connection keeps (a|no) password$/, (world: CoreWorld, label: string, kept: string) => {
  expect(labelled(world, label)).toMatchObject({ hasPassword: kept === 'a', hasApiKey: false });
});

Then('the {string} connection is {string} with a kept key', (world: CoreWorld, label: string, url: string) => {
  const connection = labelled(world, label);
  expect(connection).toEqual({ id: connection.id, program: 'sabnzbd', label, url, hasPassword: false, hasApiKey: true, routingKey: `${connection.id}:0` });
});

Then(/^the "([^"]*)" connection is locked and (\d+) archive downloaders? (?:is|are) offered$/, (world: CoreWorld, label: string, count: string) => {
  expect(settings(world).state().locked).toEqual([labelled(world, label).id]);
  expect(settings(world).routing('nzb').all()).toHaveLength(Number(count));
  expect(settings(world).routing('nzb').byId(labelled(world, label).id)).toBeUndefined();
});

Then('no connection is locked', (world: CoreWorld) => {
  expect(settings(world).state().locked).toEqual([]);
});

Then('the connections are labelled {string}', (world: CoreWorld, labels: string) => {
  expect(settings(world).state().connections.map((connection) => connection.label).join(',')).toBe(labels);
});

Then('labelling a new transmission connection {string} is refused with {string}', async (world: CoreWorld, label: string, reason: string) => {
  await attempt(world, () => settings(world).add('transmission', { url: DOWNLOAD_PROGRAMS.transmission.example }, label));
  refused(world, reason);
});

Then('labelling a new transmission connection with {int} characters is refused with {string}', async (world: CoreWorld, length: number, reason: string) => {
  await attempt(world, () => settings(world).add('transmission', { url: DOWNLOAD_PROGRAMS.transmission.example }, 'x'.repeat(length)));
  refused(world, reason);
});

Then('relabelling {string} with {int} characters is refused with {string}', async (world: CoreWorld, label: string, length: number, reason: string) => {
  await attempt(world, () => settings(world).update(labelled(world, label).id, { label: 'x'.repeat(length) }));
  refused(world, reason);
});

Then(/^the (torrent|sharing) default is "([^"]*)"$/, (world: CoreWorld, kind: string, label: string) => {
  expect(settings(world).state().defaults[kind === 'torrent' ? 'torrent' : 'soulseek']).toBe(labelled(world, label).id);
});

Then('there is no torrent default', (world: CoreWorld) => {
  expect(settings(world).state().defaults.torrent).toBeUndefined();
});

Then('the preferred torrent connection is {string}', (world: CoreWorld, label: string) => {
  expect(settings(world).routing('torrent').preferred()?.connection.label).toBe(label);
});

Then('choosing {string} for torrents is refused with {string}', async (world: CoreWorld, label: string, reason: string) => {
  await attempt(world, () => settings(world).chooseDefault('torrent', labelled(world, label).id));
  refused(world, reason);
});

Then('choosing a connection that does not exist for sharing is refused with {string}', async (world: CoreWorld, reason: string) => {
  await attempt(world, () => settings(world).chooseDefault('soulseek', 'no-such-connection'));
  refused(world, reason);
});

Then('changing a connection that does not exist is refused with {string}', async (world: CoreWorld, reason: string) => {
  await attempt(world, () => settings(world).update('no-such-connection', { label: 'Den' }));
  refused(world, reason);
});

Then('checking the transmission program against the {string} connection is refused with {string}', async (world: CoreWorld, label: string, reason: string) => {
  await attempt(world, () => settings(world).check('transmission', { url: DOWNLOAD_PROGRAMS.transmission.example }, labelled(world, label).id));
  refused(world, reason);
});

Then('the {string} connection\'s routing key is its id and {int}', (world: CoreWorld, label: string, generation: number) => {
  const connection = labelled(world, label);
  expect(connection.routingKey).toBe(`${connection.id}:${generation}`);
});

Then(/^(\d+) archive downloaders? (?:is|are) offered, called "([^"]*)"$/, (world: CoreWorld, count: string, names: string) => {
  const offered = settings(world).routing('nzb').all();
  expect(offered).toHaveLength(Number(count));
  expect(offered.map((routed) => routed.connection.label).join(',')).toBe(names);
  expect(offered.every((routed) => typeof routed.client.list === 'function')).toBe(true);
});

Then('a sharing daemon is offered', (world: CoreWorld) => {
  expect(settings(world).routing('soulseek').preferred()).toBeDefined();
});

Then(/^the sharing daemon offered is (the same|a new) client$/, (world: CoreWorld, which: string) => {
  const now = settings(world).routing('soulseek').preferred()?.client;
  expect(state(world).lastSharing).toBeDefined();
  expect(now === state(world).lastSharing).toBe(which === 'the same');
});

Then('the torrent routing has nothing to offer', (world: CoreWorld) => {
  expect(settings(world).routing('torrent').all()).toEqual([]);
  expect(settings(world).routing('torrent').preferred()).toBeUndefined();
});

Then('no torrent client or sharing daemon is offered', (world: CoreWorld) => {
  expect(settings(world).routing('torrent').preferred()).toBeUndefined();
  expect(settings(world).routing('soulseek').preferred()).toBeUndefined();
});

async function keepsAndForgets(provider: SecretsProvider, value: string): Promise<void> {
  expect(await provider.get('probe')).toBeUndefined();
  await provider.set('probe', value);
  expect(await provider.get('probe')).toBe(value);
  await provider.delete('probe');
  await provider.delete('probe');
  expect(await provider.get('probe')).toBeUndefined();
}

Then('the storage provider keeps {string} as typed on {string} and forgets it when asked', async (_world: CoreWorld, value: string, label: string) => {
  const provider = createStorageSecrets(new MemoryStorage());
  expect(provider.description).toEqual({ label, keeps: 'plain' });
  await keepsAndForgets(provider, value);
});

Then('the memory provider keeps {string} for {string} and forgets it when asked', async (_world: CoreWorld, value: string, label: string) => {
  const provider = createMemorySecrets();
  expect(provider.description).toEqual({ label, keeps: 'session' });
  await keepsAndForgets(provider, value);
});

Then('the page scheme is {string} where there is no page', (_world: CoreWorld, scheme: string) => {
  expect(currentPageScheme()).toBe(scheme);
  expect(createDownloadClients({ storage: new MemoryStorage() }).state()).toEqual({ connections: [], defaults: {}, locked: [] });
});

Then('the page scheme is {string} on a page loaded over {string}', (_world: CoreWorld, scheme: string, protocol: string) => {
  (globalThis as { location?: unknown }).location = { protocol };
  expect(currentPageScheme()).toBe(scheme);
});

Then('the programs kernl can drive are {string}', (_world: CoreWorld, names: string) => {
  expect(Object.keys(DOWNLOAD_PROGRAMS).join(',')).toBe(names);
});

Then('the storage provider answers {string} when its storage refuses the write', async (_world: CoreWorld, reason: string) => {
  const full = { getItem: () => null, removeItem: () => undefined, setItem: () => { throw new Error('QuotaExceededError: k1'); } };
  await expect(createStorageSecrets(full).set('probe', 'k1')).rejects.toThrow(new Error(reason));
});
