import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import type { Bridge, BridgeAvailability } from '@kernlize/bridges';
import { abbreviate, DEFAULT_WINDOW_SIZE, LAYOUT_KEY, publisherWords, RECENT_KEY, shortId, type ConsentSummary } from '../../src/shell/contract.ts';
import { choiceNote, domainChoices, domainLabel, formatBytes, type DomainChoice } from '../../src/shell/domains.ts';
import { openFailure } from '../../src/shell/launcher-reasons.ts';
import { serverAddress, serverLabel, serverName } from '../../src/shell/servers.ts';
import { namesProtocol } from '../../src/shell/vocabulary.ts';
import { messagingError, unavailableWhy } from '../../src/shell/messaging-reasons.ts';
import { eventDetails, type EventDetail } from '../../src/shell/event-details.ts';
import { bridgeName, bridgeRows } from '../../src/shell/bridge-names.ts';
import { REPLY_RULES, alwaysMeans, moved, rememberChoices, replyQuestion, settledWords } from '../../src/shell/reply-words.ts';
import type { ReplyPrompt } from '@kernlize/messaging';
import { shellTheme } from '../../src/shell/shell-theme.ts';
import './shell-windows.ts';

type ShellRecord = ConsentSummary['event'];

interface WordsScratch {
  applet: { requires: string[]; optional: string[]; baseline: string[]; granted: string[]; available: string[]; firstRun: boolean; receives?: boolean };
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
    applet: { requires: [], optional: [], baseline: [], granted: [], available: [], firstRun: true },
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
  expect(DEFAULT_WINDOW_SIZE).toEqual({ w: width, h: height });
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

Given('the shell can offer {string}', (world: WordsWorld, available: string) => {
  words(world).applet.available = list(available);
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
    available: row.available === 'yes',
  }));
  expect(words(world).choices).toEqual(expected);
});

Then('the domain choices are captioned:', (world: WordsWorld, table: DataTable) => {
  expect(words(world).choices.map((choice) => ({ domain: choice.domain, note: choiceNote(choice) }))).toEqual(table.hashes());
});

Then('the shell explains the open failure {string} as {string}', (_world: WordsWorld, reason: string, text: string) => {
  expect(openFailure(reason)).toEqual({ words: text, expected: true });
});

Then('the shell explains the thrown open failure {string} as {string}', (_world: WordsWorld, reason: string, text: string) => {
  expect(openFailure(new Error(reason))).toEqual({ words: text, expected: true });
});

Then('the shell explains the unexpected open failure {string} as {string}', (_world: WordsWorld, reason: string, text: string) => {
  expect(openFailure(new Error(reason))).toEqual({ words: text, expected: false });
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

interface ReplyWordsWorld {
  replyPrompt?: ReplyPrompt;
}

const providerNamed = (name: string): ReplyPrompt['theirs'] => ({ name }) as ReplyPrompt['theirs'];

Given('a reply question about {string} who wrote through {string} while the order picks {string}', (world: ReplyWordsWorld, label: string, theirs: string, mine: string) => {
  world.replyPrompt = { peer: { pubkey: 'ab'.repeat(32), label }, theirs: providerNamed(theirs), mine: providerNamed(mine) };
});

Given('a reply question about the account {string} who wrote through {string} while the order picks {string}', (world: ReplyWordsWorld, pubkey: string, theirs: string, mine: string) => {
  world.replyPrompt = { peer: { pubkey }, theirs: providerNamed(theirs), mine: providerNamed(mine) };
});

Then('the reply question reads {string}', (world: ReplyWordsWorld, text: string) => {
  expect(replyQuestion(world.replyPrompt as ReplyPrompt)).toBe(text);
});

Then('the reply question can be kept {string}', (world: ReplyWordsWorld, labels: string) => {
  const choices = rememberChoices(world.replyPrompt as ReplyPrompt);
  expect(choices.map((choice) => choice.label)).toEqual(labels.split(' | '));
  expect(choices.map((choice) => choice.id)).toEqual(['once', 'conversation', 'always']);
});

Then('keeping {string} for everyone means {string}', (_world: ReplyWordsWorld, use: string, words: string) => {
  expect(alwaysMeans(use as 'theirs' | 'mine')).toBe(words);
});

Then('the reply rules are {string}', (_world: ReplyWordsWorld, labels: string) => {
  expect(REPLY_RULES.map((rule) => rule.label)).toEqual(labels.split(' | '));
  expect(REPLY_RULES.map((rule) => rule.id)).toEqual(['ask', 'theirs', 'mine']);
  for (const rule of REPLY_RULES) expect(rule.help).not.toBe('');
});

Then('{int} settled answers read {string}', (_world: ReplyWordsWorld, count: number, words: string) => {
  expect(settledWords(count)).toBe(words);
});

Then('moving {string} {int} in {string} gives {string}', (_world: ReplyWordsWorld, id: string, step: number, order: string, expected: string) => {
  expect(moved(order.split(','), id, step as -1 | 1)).toEqual(expected.split(','));
});

interface ThemeWorld {
  tokens?: Map<string, string>;
}

const readToken = (world: ThemeWorld) => (token: string): string => world.tokens?.get(token) ?? '';

Given("the page's style tokens {string}", (world: ThemeWorld, tokens: string) => {
  world.tokens = new Map(tokens.split(';').map((pair) => pair.split(':').map((part) => part.trim()) as [string, string]));
});

Then("the shell's theme is background {string}, text {string} and primary {string}", (world: ThemeWorld, background: string, text: string, primary: string) => {
  expect(shellTheme(readToken(world))).toEqual({ colors: { background, text, primary } });
});

Then('the shell has no theme', (world: ThemeWorld) => {
  expect(shellTheme(readToken(world))).toBeUndefined();
});

Then('an applet at {string} published by {string} is said to be {string}', (_world: unknown, address: string, publisher: string, words: string) => {
  expect(publisherWords({ address, publisher })).toBe(words);
});
