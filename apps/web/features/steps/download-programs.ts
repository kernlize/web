import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { DOWNLOAD_PROGRAMS, type CheckedConnection, type DownloadClients, type DownloadConnection } from '@kernlize/core';
import { MemoryStorage } from '../../../../packages/core/features/steps/world.ts';
import { createPreviewAccountServices } from '../../src/shell/preview-mailboxes.ts';
import { draftChanged, draftOf, fieldLabel, hasSecret, isSecretField, noteWords, programError, programStatus, PROGRAM_GROUPS, signInOf, type ProgramDraft } from '../../src/shell/download-programs.ts';

interface ProgramWorld {
  previewPrograms?: DownloadClients;
  previewChecked?: CheckedConnection;
  saved?: DownloadConnection;
  draft?: ProgramDraft;
}

const PASSWORD_PROGRAM = DOWNLOAD_PROGRAMS.transmission.signIn;
const KEY_PROGRAM = DOWNLOAD_PROGRAMS.sabnzbd.signIn;
const EXAMPLE = DOWNLOAD_PROGRAMS.transmission.example;
const SAVED: DownloadConnection = { url: EXAMPLE, hasPassword: false, hasApiKey: false };

function draft(world: ProgramWorld): ProgramDraft {
  if (!world.draft) throw new Error('open the form first');
  return world.draft;
}

Given('a saved download program at {string} signed in as {string} with a kept password', (world: ProgramWorld, url: string, username: string) => {
  world.saved = { url, username, hasPassword: true, hasApiKey: false };
  world.draft = draftOf(world.saved);
});

Given('a download program form with the address {string}, the name {string}, the password {string} and the key {string}', (world: ProgramWorld, url: string, username: string, password: string, apiKey: string) => {
  world.draft = { url, username, password, apiKey };
});

When("the person changes the download program's name to {string}", (world: ProgramWorld, username: string) => {
  world.draft = { ...draft(world), username };
});

Then('the download program form shows the address {string}, the name {string} and no password', (world: ProgramWorld, url: string, username: string) => {
  expect(draft(world)).toEqual({ url, username, password: '', apiKey: '' });
});

Then('the download program form has nothing to save', (world: ProgramWorld) => {
  expect(draftChanged(draft(world), world.saved)).toBe(false);
});

Then('the download program form has something to save', (world: ProgramWorld) => {
  expect(draftChanged(draft(world), world.saved)).toBe(true);
});

Then('the form is told a password is kept, and no key', (world: ProgramWorld) => {
  expect([hasSecret(world.saved, 'password'), hasSecret(world.saved, 'apiKey'), hasSecret(world.saved, 'username'), hasSecret(undefined, 'password')]).toEqual([true, false, false, false]);
  expect(hasSecret({ url: EXAMPLE, hasPassword: false, hasApiKey: true }, 'apiKey')).toBe(true);
});

Then('a program that takes a name and password would be checked at {string} as {string} with the password {string}', (world: ProgramWorld, url: string, username: string, password: string) => {
  expect(signInOf(draft(world), PASSWORD_PROGRAM)).toEqual({ url, username, password });
});

Then('a program that takes only a key would be checked at {string} with the key {string} and nothing else', (world: ProgramWorld, url: string, apiKey: string) => {
  expect(signInOf(draft(world), KEY_PROGRAM)).toEqual({ url, apiKey });
});

Then('a secret left empty is left out, for the shell to fill from what it keeps', () => {
  expect(signInOf({ url: EXAMPLE, username: '', password: '', apiKey: '' }, DOWNLOAD_PROGRAMS.slskd.signIn)).toEqual({ url: EXAMPLE });
});

Then('a program never set up has something to save once an address is typed', () => {
  const saved: DownloadConnection = { url: EXAMPLE, hasPassword: false, hasApiKey: false };
  expect(draftChanged(draftOf(undefined), undefined)).toBe(false);
  expect(draftChanged({ ...draftOf(undefined), url: 'localhost:1' }, undefined)).toBe(true);
  expect(draftChanged({ ...draftOf(saved), url: `${EXAMPLE}/other` }, saved)).toBe(true);
  expect(draftChanged({ ...draftOf(saved), apiKey: 'k' }, saved)).toBe(true);
  expect(draftChanged({ ...draftOf(saved), password: 'p' }, saved)).toBe(true);
});

Then('the download program reason {string} is explained with {string}', (_world: ProgramWorld, reason: string, words: string) => {
  expect(programError(new Error(reason))).toContain(words);
  expect(programError(reason)).toContain(words);
  expect(programError(new Error(reason))).not.toContain(reason.split(' ')[0]);
});

Then('the download program note {string} says {string}', (_world: ProgramWorld, note: string, words: string) => {
  expect(noteWords(note)).toContain(words);
});

Then('the download program note {string} says nothing', (_world: ProgramWorld, note: string) => {
  expect(noteWords(note)).toBeUndefined();
});

Then('a download program that is not set up reads {string}', (_world: ProgramWorld, words: string) => {
  expect(programStatus(undefined, undefined)).toBe(words);
});

Then('a download program that is saved reads {string}', (_world: ProgramWorld, words: string) => {
  expect(programStatus(SAVED, undefined)).toBe(words);
});

Then('a download program that answered as version {string} reads {string}', (_world: ProgramWorld, version: string, words: string) => {
  expect(programStatus(SAVED, version)).toBe(words);
});

Then('a download program whose kept sign-in is locked reads {string}', (_world: ProgramWorld, words: string) => {
  expect(programStatus(SAVED, '1.0', true)).toBe(words);
});

Then('the download program fields are called {string}, {string} and {string}, and the last two are secrets', (_world: ProgramWorld, name: string, password: string, key: string) => {
  expect([fieldLabel('username'), fieldLabel('password'), fieldLabel('apiKey')]).toEqual([name, password, key]);
  expect([isSecretField('username'), isSecretField('password'), isSecretField('apiKey')]).toEqual([false, true, true]);
});

Then('every download program belongs to exactly one group', () => {
  const grouped = PROGRAM_GROUPS.flatMap((group) => group.programs);
  expect([...grouped].sort()).toEqual(Object.keys(DOWNLOAD_PROGRAMS).sort());
});

Given("the preview's download programs", (world: ProgramWorld) => {
  const services = createPreviewAccountServices(new MemoryStorage());
  expect(services.secrets).toEqual({ label: 'this device', keeps: 'plain' });
  world.previewPrograms = services.downloads;
});

When('the preview checks the download program address {string}', async (world: ProgramWorld, url: string) => {
  world.previewChecked = await world.previewPrograms?.check('transmission', { url, username: 'ann' });
});

Then('the preview says it would be reached at {string} and reports the version {string}', (world: ProgramWorld, url: string, version: string) => {
  expect(world.previewChecked?.signIn).toEqual({ url, username: 'ann' });
  expect(world.previewChecked?.probe.version).toBe(version);
});

Then('the preview refuses the download program address {string} with {string}', async (world: ProgramWorld, url: string, reason: string) => {
  await expect(world.previewPrograms?.check('transmission', { url })).rejects.toThrow(reason);
});

Then("the preview's own requests go nowhere", async (world: ProgramWorld) => {
  await world.previewPrograms?.save('transmission', { url: 'http://localhost:9091' });
  await expect(world.previewPrograms?.torrent()?.probe()).rejects.toThrow('unavailable:unreachable');
});
