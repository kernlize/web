import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import type { Bridge, BridgeAvailability } from '@kernlize/bridges';
import { abbreviate, DEFAULT_WINDOW_SIZE, LAYOUT_KEY, RECENT_KEY, shortId, type ConsentSummary } from '../../src/shell/contract.ts';
import { domainChoices, domainLabel, formatBytes, type DomainChoice } from '../../src/shell/domains.ts';
import { serverAddress, serverLabel, serverName } from '../../src/shell/servers.ts';
import { namesProtocol } from '../../src/shell/vocabulary.ts';
import { messagingError, unavailableWhy } from '../../src/shell/messaging-reasons.ts';
import { eventDetails, type EventDetail } from '../../src/shell/event-details.ts';
import { bridgeName, bridgeRows } from '../../src/shell/bridge-names.ts';
import './shell-windows.ts';

type ShellRecord = ConsentSummary['event'];

interface WordsScratch {
  applet: { requires: string[]; optional: string[]; baseline: string[]; granted: string[]; firstRun: boolean; receives?: boolean };
  choices: DomainChoice[];
  record: ShellRecord;
  details: readonly EventDetail[];
  bridge?: Bridge;
}

interface WordsWorld {
  shellWords?: WordsScratch;
}

function words(world: WordsWorld): WordsScratch {
  world.shellWords ??= {
    applet: { requires: [], optional: [], baseline: [], granted: [], firstRun: true },
    choices: [],
    record: { id: '', kind: 1, pubkey: '', created_at: 0, content: '', tags: [], sig: '' },
    details: [],
  };
  return world.shellWords;
}

const list = (value: string): string[] => value.split(',').map((item) => item.trim()).filter(Boolean);

Then('the shell shortens {string} to the badge {string}', (_world: WordsWorld, value: string, badge: string) => {
  expect(shortId(value)).toBe(badge);
});

Then('the shell abbreviates {string} as {string}', (_world: WordsWorld, value: string, short: string) => {
  expect(abbreviate(value)).toBe(short);
});

Then('a new shell window opens at {int} by {int}', (_world: WordsWorld, width: number, height: number) => {
  expect(DEFAULT_WINDOW_SIZE).toEqual({ width, height });
});

Then('the shell keeps recent applets under {string} and the layout under {string}', (_world: WordsWorld, recent: string, layout: string) => {
  expect([RECENT_KEY, LAYOUT_KEY]).toEqual([recent, layout]);
});

Then('the shell text {string} names the protocol', (_world: WordsWorld, text: string) => {
  expect(namesProtocol(text)).toBe(true);
});

Then('the shell text {string} does not name the protocol', (_world: WordsWorld, text: string) => {
  expect(namesProtocol(text)).toBe(false);
});

Then('the shell calls the domain {string} {string}', (_world: WordsWorld, domain: string, label: string) => {
  expect(domainLabel(domain)).toBe(label);
});

Given('an applet that requires {string} and may use {string}', (world: WordsWorld, requires: string, optional: string) => {
  Object.assign(words(world).applet, { requires: list(requires), optional: list(optional) });
});

Given('the shell baseline is {string}', (world: WordsWorld, baseline: string) => {
  words(world).applet.baseline = list(baseline);
});

Given('the applet was earlier granted {string}', (world: WordsWorld, granted: string) => {
  words(world).applet.granted = list(granted);
});

Given('the applet takes requests from other applets', (world: WordsWorld) => {
  words(world).applet.receives = true;
});

Given('the person has decided for this applet before', (world: WordsWorld) => {
  words(world).applet.firstRun = false;
});

When('the shell lists the domain choices', (world: WordsWorld) => {
  words(world).choices = domainChoices(words(world).applet);
});

Then('the domain choices are:', (world: WordsWorld, table: DataTable) => {
  const expected = table.hashes().map((row) => ({
    domain: row.domain,
    label: row.label,
    required: row.required === 'yes',
    baseline: row.baseline === 'yes',
    granted: row.granted === 'yes',
    preset: row.preset === 'yes',
  }));
  expect(words(world).choices).toEqual(expected);
});

Then('the shell shows {float} bytes as {string}', (_world: WordsWorld, bytes: number, text: string) => {
  expect(formatBytes(bytes)).toBe(text);
});

Then('the shell reads the server {string} as {string}', (_world: WordsWorld, address: string, name: string) => {
  expect(serverName(address)).toBe(name);
});

Then('the shell labels the server {string} in {string} at index {int} as {string}', (_world: WordsWorld, address: string, tier: string, index: number, label: string) => {
  expect(serverLabel(address, tier, index)).toBe(label);
});

Then('the shell stores the typed server {string} as {string}', (_world: WordsWorld, input: string, address: string) => {
  expect(serverAddress(input)).toBe(address);
});

Then('the shell explains the unavailable reason {string} as {string}', (_world: WordsWorld, reason: string, text: string) => {
  expect(unavailableWhy(reason)).toBe(text);
});

Then('the shell explains the messaging refusal {string} as {string}', (_world: WordsWorld, reason: string, text: string) => {
  expect(messagingError(reason)).toBe(text);
});

Then('the shell explains the thrown messaging error {string} as {string}', (_world: WordsWorld, reason: string, text: string) => {
  expect(messagingError(new Error(reason))).toBe(text);
});

Given('a record to sign of type {int} by {string} at {int} saying {string}', (world: WordsWorld, kind: number, pubkey: string, at: number, content: string) => {
  Object.assign(words(world).record, { kind, pubkey, created_at: at, content });
});

Given('the record to sign carries the labels:', (world: WordsWorld, table: DataTable) => {
  words(world).record.tags = table.raw().map(([cell = '']) => cell.split(' ').filter(Boolean));
});

Given('the record to sign has the identifier {string}', (world: WordsWorld, id: string) => {
  words(world).record.id = id;
});

When('the shell spells out the record for the account {string}', (world: WordsWorld, account: string) => {
  words(world).details = eventDetails(words(world).record, account);
});

When('the shell spells out the record with no account', (world: WordsWorld) => {
  words(world).details = eventDetails(words(world).record);
});

Then('the record reads:', (world: WordsWorld, table: DataTable) => {
  expect(words(world).details).toEqual(table.hashes());
});

function fakeBridge(id: string, label: string, availability: BridgeAvailability): Bridge {
  return {
    id,
    label,
    schemes: [],
    exposure: { revealsAddress: true, encryptedInTransit: false, publicActivity: false },
    availability: () => availability,
    resolve: () => Promise.reject(new Error('unavailable:fake')),
  };
}

Given('a shell bridge {string} for {string} that is ready', (world: WordsWorld, id: string, label: string) => {
  words(world).bridge = fakeBridge(id, label, { available: true });
});

Given('a shell bridge {string} for {string} that hands off to an app', (world: WordsWorld, id: string, label: string) => {
  words(world).bridge = fakeBridge(id, label, { available: true, handoff: true });
});

Given('a shell bridge {string} for {string} that is unavailable with {string}', (world: WordsWorld, id: string, label: string, reason: string) => {
  words(world).bridge = fakeBridge(id, label, { available: false, reason });
});

Then('the shell names the bridge {string}', (world: WordsWorld, name: string) => {
  expect(bridgeName(words(world).bridge as Bridge)).toBe(name);
});

Then('the shell describes the bridge as:', (world: WordsWorld, table: DataTable) => {
  expect(bridgeRows(words(world).bridge as Bridge)).toEqual(table.hashes());
});
