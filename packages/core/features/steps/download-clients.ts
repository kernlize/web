import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { createDownloadClients, createMemorySecrets, createStorageSecrets, currentPageScheme, DOWNLOAD_PROGRAMS, type CheckedConnection, type DownloadClients, type DownloadProgram, type SecretsProvider, type TorrentProgram } from '@kernlize/core';
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
}

/** The default provider over the scenario's storage, able to refuse or withhold as a real keeper can. */
function faultySecrets(programs: ProgramsScratch): SecretsProvider {
  const real = createStorageSecrets(programs.storage);
  return {
    description: real.description,
    get: (name) => (programs.fault === 'withholds' ? Promise.reject(new Error('unavailable:secrets')) : real.get(name)),
    set: (name, value) => (programs.fault === 'refuses' ? Promise.reject(new Error('denied:secrets')) : real.set(name, value)),
    delete: (name) => real.delete(name),
  };
}

const STORAGE_KEY = 'kernl:download-programs:v1';

function state(world: CoreWorld): ProgramsScratch {
  const bag = scratch(world) as { programs?: ProgramsScratch };
  bag.programs ??= { storage: new MemoryStorage(), page: 'http' };
  return bag.programs;
}

function settings(world: CoreWorld): DownloadClients {
  const { settings: value } = state(world);
  if (!value) throw new Error('open the settings first');
  return value;
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

Given('stored download programs holding the plain address {string}, a broken entry and a choice of a program that is not set up', (world: CoreWorld, url: string) => {
  state(world).storage.setItem(STORAGE_KEY, JSON.stringify({
    connections: { sabnzbd: { url, hasApiKey: true }, nzbget: 'not a connection', slskd: { url: 7 }, transmission: { url: DOWNLOAD_PROGRAMS.transmission.example, username: 12 } },
    torrentProgram: 'utorrent',
  }));
});

When('the person checks the transmission program at its bare address as {string} with {string}', async (world: CoreWorld, username: string, password: string) => {
  const bare = new URL(state(world).transmission?.url as string).host;
  await attempt(world, async () => {
    state(world).checked = await settings(world).check('transmission', { url: bare, username, password });
  });
});

When('the person checks and saves the transmission program as {string} with {string}', async (world: CoreWorld, username: string, password: string) => {
  const checked = await settings(world).check('transmission', { url: new URL(state(world).transmission?.url as string).host, username, password });
  await settings(world).save('transmission', checked.signIn);
});

When('the person tries to save the sabnzbd program at {string}', (world: CoreWorld, url: string) => attempt(world, () => settings(world).save('sabnzbd', { url, apiKey: 'k1' })));

When('the person tries to save the nzbget program with a password {int} characters long', (world: CoreWorld, length: number) =>
  attempt(world, () => settings(world).save('nzbget', { url: DOWNLOAD_PROGRAMS.nzbget.example, username: 'ann', password: 'p'.repeat(length) })));

When('the person saves the {word} program at {string} with the key {string}', async (world: CoreWorld, program: DownloadProgram, url: string, apiKey: string) => {
  state(world).lastSharing = settings(world).soulseek();
  await settings(world).save(program, { url, apiKey, username: '', password: '' });
});

When('the person saves the {word} program at {string} with the name {string}', async (world: CoreWorld, program: DownloadProgram, url: string, username: string) => {
  await settings(world).save(program, { url, username });
});

Given('a secrets provider that refuses to keep anything', (world: CoreWorld) => {
  state(world).fault = 'refuses';
});

When('the secrets provider stops handing secrets over', (world: CoreWorld) => {
  state(world).fault = 'withholds';
});

When('the secrets provider hands secrets over again', (world: CoreWorld) => {
  state(world).fault = undefined;
});

When('the person chooses {string} for torrents', (world: CoreWorld, program: TorrentProgram) => settings(world).chooseTorrent(program));

When('the person removes the {string} program', (world: CoreWorld, program: DownloadProgram) => settings(world).remove(program));

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
  const { checked, transmission } = state(world);
  expect(checked?.signIn.url).toBe(transmission?.url.replace(/\/$/, ''));
  expect(checked?.signIn.url.startsWith(`${scheme}://`)).toBe(true);
  expect(checked?.notes).toEqual([note]);
});

Then('the checked program reports the version {string}', (world: CoreWorld, version: string) => {
  expect(state(world).checked?.probe.version).toBe(version);
});

Then('nothing is set up yet', (world: CoreWorld) => {
  expect(settings(world).state()).toEqual({ connections: {}, locked: [] });
});

Then('the download program check fails with {string}', (world: CoreWorld, reason: string) => {
  expect((state(world).error as Error).message.startsWith(reason)).toBe(true);
});

Then('saving the download program is refused with {string}', (world: CoreWorld, reason: string) => {
  expect((state(world).error as Error | undefined)?.message).toBe(reason);
});

Then('the settings name {string} as set up and as the torrent program', (world: CoreWorld, program: TorrentProgram) => {
  const seen: unknown[] = [];
  settings(world).state$.subscribe((value) => seen.push(value)).unsubscribe();
  expect(seen).toEqual([settings(world).state()]);
  expect(Object.keys(settings(world).state().connections)).toEqual([program]);
  expect(settings(world).state().torrentProgram).toBe(program);
});

Then('the settings name {string} as set up', (world: CoreWorld, program: string) => {
  expect(Object.keys(settings(world).state().connections)).toEqual([program]);
});

Then('the torrent client the services call lists {int} torrents from the real program', async (world: CoreWorld, count: number) => {
  expect(await settings(world).torrent()?.list()).toHaveLength(count);
  expect(state(world).transmission?.calls.map((call) => call.method)).toContain('torrent-get');
});

Then('the same torrent client is kept between calls', (world: CoreWorld) => {
  expect(settings(world).torrent()).toBe(settings(world).torrent());
});

Then('the settings record holds the address and name, and no password', (world: CoreWorld) => {
  const raw = state(world).storage.getItem(STORAGE_KEY) as string;
  expect(JSON.parse(raw)).toEqual({ connections: { transmission: { url: state(world).transmission?.url.replace(/\/$/, ''), username: 'ann', hasPassword: true, hasApiKey: false } }, torrentProgram: 'transmission' });
  expect(raw).not.toContain('s3cret');
  expect(JSON.stringify(settings(world).state())).not.toContain('s3cret');
});

Then('the password is with the secrets provider under {string}', async (world: CoreWorld, name: string) => {
  expect(await createStorageSecrets(state(world).storage).get(name)).toBe('s3cret');
});

Then('the secrets provider holds nothing for {string}', async (world: CoreWorld, name: string) => {
  expect(await createStorageSecrets(state(world).storage).get(name)).toBeUndefined();
});

Then('the {string} connection keeps no password', (world: CoreWorld, program: DownloadProgram) => {
  expect(settings(world).state().connections[program]).toMatchObject({ hasPassword: false, hasApiKey: false });
});

Then('the {string} connection is {string} with a kept key', (world: CoreWorld, program: DownloadProgram, url: string) => {
  expect(settings(world).state().connections[program]).toEqual({ url, hasPassword: false, hasApiKey: true });
});

Then('the {string} program is locked and no archive downloader is offered', (world: CoreWorld, program: DownloadProgram) => {
  expect(settings(world).state().locked).toEqual([program]);
  expect(settings(world).nzb()).toEqual([]);
});

Then('no program is locked', (world: CoreWorld) => {
  expect(settings(world).state().locked).toEqual([]);
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
  const storage = new MemoryStorage();
  const provider = createStorageSecrets(storage);
  expect(provider.description).toEqual({ label, keeps: 'plain' });
  await keepsAndForgets(provider, value);
});

Then('the memory provider keeps {string} for {string} and forgets it when asked', async (_world: CoreWorld, value: string, label: string) => {
  const provider = createMemorySecrets();
  expect(provider.description).toEqual({ label, keeps: 'session' });
  await keepsAndForgets(provider, value);
});

Then(/^(\d+) archive downloaders? (?:is|are) offered, called "([^"]*)"$/, (world: CoreWorld, count: string, names: string) => {
  const offered = settings(world).nzb();
  expect(offered).toHaveLength(Number(count));
  expect(offered.map((downloader) => downloader.label).join(',')).toBe(names);
  expect(offered.every((downloader) => typeof downloader.client.list === 'function')).toBe(true);
});

Then('a sharing daemon is offered', (world: CoreWorld) => {
  expect(settings(world).soulseek()).toBeDefined();
});

Then('the sharing daemon offered is a new client', (world: CoreWorld) => {
  expect(settings(world).soulseek()).not.toBe(state(world).lastSharing);
  expect(state(world).lastSharing).toBeDefined();
});

Then('the torrent program is {string}', (world: CoreWorld, program: string) => {
  expect(settings(world).state().torrentProgram).toBe(program);
  expect(settings(world).torrent()).toBeDefined();
});

Then('the torrent program is unset', (world: CoreWorld) => {
  expect(settings(world).state().torrentProgram).toBeUndefined();
});

Then('choosing {string} for torrents is refused with {string}', async (world: CoreWorld, program: TorrentProgram, reason: string) => {
  await attempt(world, () => settings(world).chooseTorrent(program));
  expect((state(world).error as Error).message).toBe(reason);
});

Then('no torrent client, archive downloader or sharing daemon is offered', (world: CoreWorld) => {
  expect(settings(world).torrent()).toBeUndefined();
  expect(settings(world).nzb()).toEqual([]);
  expect(settings(world).soulseek()).toBeUndefined();
});

Then('the page scheme is {string} where there is no page', (_world: CoreWorld, scheme: string) => {
  expect(currentPageScheme()).toBe(scheme);
  expect(createDownloadClients({ storage: new MemoryStorage() }).state()).toEqual({ connections: {}, locked: [] });
});

Then('the page scheme is {string} on a page loaded over {string}', (_world: CoreWorld, scheme: string, protocol: string) => {
  (globalThis as { location?: unknown }).location = { protocol };
  expect(currentPageScheme()).toBe(scheme);
});

Then('the programs kernl can drive are {string}', (_world: CoreWorld, names: string) => {
  expect(Object.keys(DOWNLOAD_PROGRAMS).join(',')).toBe(names);
});
