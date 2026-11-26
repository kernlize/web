import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { DOWNLOAD_PROGRAMS, type DownloadClientsState, type DownloadConnection, type DownloadProgram } from '@kernlize/core';
import {
  addFormName,
  connectionsIn,
  draftChanged,
  draftOf,
  fieldLabel,
  hasSecret,
  isSecretField,
  labelOf,
  noteWords,
  programBeside,
  programError,
  programStatus,
  PROGRAM_GROUPS,
  showsChooser,
  signInOf,
  type ProgramDraft,
  type ProgramGroup,
} from '../../src/shell/download-programs.ts';

interface ProgramWorld {
  saved?: DownloadConnection;
  draft?: ProgramDraft;
  connections?: DownloadClientsState;
}

const PASSWORD_PROGRAM = DOWNLOAD_PROGRAMS.transmission.signIn;
const KEY_PROGRAM = DOWNLOAD_PROGRAMS.sabnzbd.signIn;
const EXAMPLE = DOWNLOAD_PROGRAMS.transmission.example;
const connection = (label: string, program: DownloadProgram, rest: Partial<DownloadConnection> = {}): DownloadConnection => ({ id: label, program, label, url: EXAMPLE, hasPassword: false, hasApiKey: false, routingKey: `${label}:0`, ...rest });
const SAVED = connection('Home', 'transmission');

function draft(world: ProgramWorld): ProgramDraft {
  if (!world.draft) throw new Error('open the form first');
  return world.draft;
}

Given('a saved download program at {string} signed in as {string} with a kept password', (world: ProgramWorld, url: string, username: string) => {
  world.saved = connection('Home', 'transmission', { url, username, hasPassword: true });
  world.draft = draftOf(world.saved);
});

Given('a download program form with the address {string}, the name {string}, the password {string} and the key {string}', (world: ProgramWorld, url: string, username: string, password: string, apiKey: string) => {
  world.draft = { label: '', url, username, password, apiKey };
});

When("the person changes the download program's name to {string}", (world: ProgramWorld, username: string) => {
  world.draft = { ...draft(world), username };
});

Then('the download program form shows the label {string}, the address {string}, the name {string} and no password', (world: ProgramWorld, label: string, url: string, username: string) => {
  expect(draft(world)).toEqual({ label, url, username, password: '', apiKey: '' });
});

Then('the download program form has nothing to save', (world: ProgramWorld) => {
  expect(draftChanged(draft(world), world.saved)).toBe(false);
});

Then('the download program form has something to save', (world: ProgramWorld) => {
  expect(draftChanged(draft(world), world.saved)).toBe(true);
});

Then('the form is told a password is kept, and no key', (world: ProgramWorld) => {
  expect([hasSecret(world.saved, 'password'), hasSecret(world.saved, 'apiKey'), hasSecret(world.saved, 'username'), hasSecret(undefined, 'password')]).toEqual([true, false, false, false]);
  expect(hasSecret(connection('Box', 'sabnzbd', { hasApiKey: true }), 'apiKey')).toBe(true);
});

Then('a program that takes a name and password would be checked at {string} as {string} with the password {string}', (world: ProgramWorld, url: string, username: string, password: string) => {
  expect(signInOf(draft(world), PASSWORD_PROGRAM)).toEqual({ url, username, password });
});

Then('a program that takes only a key would be checked at {string} with the key {string} and nothing else', (world: ProgramWorld, url: string, apiKey: string) => {
  expect(signInOf(draft(world), KEY_PROGRAM)).toEqual({ url, apiKey });
});

Then('a secret left empty is left out, for the shell to fill from what it keeps', () => {
  expect(signInOf({ label: '', url: EXAMPLE, username: '', password: '', apiKey: '' }, DOWNLOAD_PROGRAMS.slskd.signIn)).toEqual({ url: EXAMPLE });
});

Then('a renamed download connection has something to save, and a blank label is left for the shell to name', (world: ProgramWorld) => {
  const renamed = { ...draftOf(world.saved), label: ' Attic ' };
  expect(draftChanged(renamed, world.saved)).toBe(true);
  expect(labelOf(renamed)).toBe('Attic');
  expect(labelOf({ ...renamed, label: '   ' })).toBeUndefined();
});

Then('a program never set up has something to save once an address is typed', () => {
  const saved = SAVED;
  expect(draftChanged(draftOf(undefined), undefined)).toBe(false);
  expect(draftChanged({ ...draftOf(undefined), url: 'localhost:1' }, undefined)).toBe(true);
  expect(draftChanged({ ...draftOf(saved), url: `${EXAMPLE}/other` }, saved)).toBe(true);
  expect(draftChanged({ ...draftOf(saved), apiKey: 'k' }, saved)).toBe(true);
  expect(draftChanged({ ...draftOf(saved), password: 'p' }, saved)).toBe(true);
});

Then('the download program reason {string} is explained with {string}', (_world: ProgramWorld, reason: string, words: string) => {
  expect(programError(new Error(reason))).toContain(words);
  expect(programError(reason)).toContain(words);
  expect(programError(new Error(reason))).not.toContain(reason.split(':')[0]);
});

Then('the download program note {string} says {string}', (_world: ProgramWorld, note: string, words: string) => {
  expect(noteWords(note)).toContain(words);
});

Then('the download program note {string} says nothing', (_world: ProgramWorld, note: string) => {
  expect(noteWords(note)).toBeUndefined();
});

Then('a download program that is saved reads {string}', (_world: ProgramWorld, words: string) => {
  expect(programStatus(undefined)).toBe(words);
});

Then('a download program that answered as version {string} reads {string}', (_world: ProgramWorld, version: string, words: string) => {
  expect(programStatus(version)).toBe(words);
});

Then('a download program whose kept sign-in is locked reads {string}', (_world: ProgramWorld, words: string) => {
  expect(programStatus('1.0', true)).toBe(words);
});

Then('the download program fields are called {string}, {string} and {string}, and the last two are secrets', (_world: ProgramWorld, name: string, password: string, key: string) => {
  expect([fieldLabel('username'), fieldLabel('password'), fieldLabel('apiKey')]).toEqual([name, password, key]);
  expect([isSecretField('username'), isSecretField('password'), isSecretField('apiKey')]).toEqual([false, true, true]);
});

Then('every download program belongs to exactly one group', () => {
  const grouped = PROGRAM_GROUPS.flatMap((group) => group.programs);
  expect([...grouped].sort()).toEqual(Object.keys(DOWNLOAD_PROGRAMS).sort());
});

function group(title: string): ProgramGroup {
  const found = PROGRAM_GROUPS.find((entry) => entry.title === title);
  if (!found) throw new Error(`no group ${title}`);
  return found;
}

function connections(world: ProgramWorld): DownloadClientsState {
  if (!world.connections) throw new Error('set up download connections first');
  return world.connections;
}

Given('download connections {string} and {string} to Transmission, {string} to uTorrent and {string} to SABnzbd', (world: ProgramWorld, first: string, second: string, box: string, archive: string) => {
  const list = [connection(first, 'transmission'), connection(second, 'transmission'), connection(box, 'utorrent'), connection(archive, 'sabnzbd')];
  world.connections = { connections: list, defaults: { torrent: first }, locked: [] };
});

Then('the {string} group lists {string}', (world: ProgramWorld, title: string, labels: string) => {
  expect(connectionsIn(connections(world), group(title)).map((entry) => entry.label).join(', ')).toBe(labels);
});

Then('the {string} group asks {string}', (world: ProgramWorld, title: string, legend: string) => {
  expect(showsChooser(connections(world), group(title))).toBe(true);
  expect(group(title).routed?.legend).toBe(legend);
});

Then('the {string} group asks nothing, since applets pick among its connections', (world: ProgramWorld, title: string) => {
  expect(showsChooser(connections(world), group(title))).toBe(false);
  expect(group(title).routed).toBeUndefined();
});

Then('the {string} group asks nothing while it has one connection or none', (world: ProgramWorld, title: string) => {
  const one = { ...connections(world), connections: [connection('slskd', 'slskd')] };
  expect([showsChooser(connections(world), group(title)), showsChooser(one, group(title))]).toEqual([false, false]);
  expect(showsChooser({ ...one, connections: [...one.connections, connection('Den', 'slskd')] }, group(title))).toBe(true);
});

Then('the row {string} names its program {string} and the row {string} names none', (world: ProgramWorld, named: string, program: string, plain: string) => {
  const byLabel = (label: string): DownloadConnection => connections(world).connections.find((entry) => entry.label === label) as DownloadConnection;
  expect([programBeside(byLabel(named)), programBeside(byLabel(plain))]).toEqual([program, undefined]);
});

Then('the add form of {string} is called {string}', (_world: ProgramWorld, title: string, name: string) => {
  expect(addFormName(group(title))).toBe(name);
});
