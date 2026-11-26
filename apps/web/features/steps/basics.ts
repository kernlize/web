import { expect } from 'vitest';
import { Given, Then, When, type DataTable } from 'quickpickle';
import type { Bridge, BridgeAvailability } from '@kernlize/bridges';
import { abbreviate, DEFAULT_WINDOW_SIZE, LAYOUT_KEY, publisherWords, RECENT_KEY, shortId, type ConsentSummary } from '../../src/shell/contract.ts';
import { openFailure } from '../../src/shell/launcher-reasons.ts';
import { hostOf, serverAddress } from '../../src/shell/servers.ts';
import { helperFrom, toolSearchWords } from '../../src/shell/meeting-words.ts';
import { namesProtocol, withoutAddresses } from '../../src/shell/vocabulary.ts';
import { messagingError, unavailableWhy } from '../../src/shell/messaging-reasons.ts';
import { eventDetails, type EventDetail } from '../../src/shell/event-details.ts';
import { bridgeName, bridgeRows } from '../../src/shell/bridge-names.ts';
import { REPLY_RULES, alwaysMeans, moved, peerName, rememberChoices, replyQuestion, settledWords } from '../../src/shell/reply-words.ts';
import type { ReplyPrompt } from '@kernlize/messaging';
import { followShellTheme, shellTheme, type ThemeSignal } from '../../src/shell/shell-theme.ts';
import './shell-windows.ts';

type ShellRecord = ConsentSummary['event'];

interface WordsScratch {
  record: ShellRecord;
  details: readonly EventDetail[];
  bridge?: Bridge;
}

interface WordsWorld {
  shellWords?: WordsScratch;
}

function words(world: WordsWorld): WordsScratch {
  world.shellWords ??= {
    record: { id: '', kind: 1, pubkey: '', created_at: 0, content: '', tags: [], sig: '' },
    details: [],
  };
  return world.shellWords;
}


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




















Then('the shell explains the open failure {string} as {string}', (_world: WordsWorld, reason: string, text: string) => {
  expect(openFailure(reason)).toEqual({ words: text, expected: true });
});

Then('the shell explains the thrown open failure {string} as {string}', (_world: WordsWorld, reason: string, text: string) => {
  expect(openFailure(new Error(reason))).toEqual({ words: text, expected: true });
});

Then('the shell explains the unexpected open failure {string} as {string}', (_world: WordsWorld, reason: string, text: string) => {
  expect(openFailure(new Error(reason))).toEqual({ words: text, expected: false });
});


Then('the shell shows the relay {string} as {string}', (_world: WordsWorld, address: string, host: string) => {
  expect(hostOf(address)).toBe(host);
});

Then('the shell text {string} without its addresses names the protocol', (_world: WordsWorld, text: string) => {
  expect(namesProtocol(withoutAddresses(text))).toBe(true);
});

Then('the shell text {string} without its addresses does not name the protocol', (_world: WordsWorld, text: string) => {
  expect(namesProtocol(withoutAddresses(text))).toBe(false);
});

Then('the shell stores the typed relay {string} as {string}', (_world: WordsWorld, input: string, address: string) => {
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
  published?: string;
}

const providerNamed = (name: string): ReplyPrompt['theirs'] => ({ name }) as ReplyPrompt['theirs'];

Given('a reply question about {string} who wrote through {string} while the order picks {string}', (world: ReplyWordsWorld, label: string, theirs: string, mine: string) => {
  world.replyPrompt = { peer: { pubkey: 'ab'.repeat(32), label }, theirs: providerNamed(theirs), mine: providerNamed(mine) };
});

Given('a reply question about the account {string} who wrote through {string} while the order picks {string}', (world: ReplyWordsWorld, pubkey: string, theirs: string, mine: string) => {
  world.replyPrompt = { peer: { pubkey }, theirs: providerNamed(theirs), mine: providerNamed(mine) };
});

When('the shell finds that they published the name {string}', (world: ReplyWordsWorld, name: string) => {
  world.published = name;
});

/** The name the chooser found, when a step gave one; otherwise the words name the person themselves. */
const namedIn = (world: ReplyWordsWorld): [ReplyPrompt] | [ReplyPrompt, string] => {
  const prompt = world.replyPrompt as ReplyPrompt;
  return world.published === undefined ? [prompt] : [prompt, peerName(prompt.peer, world.published)];
};

Then('the reply question reads {string}', (world: ReplyWordsWorld, text: string) => {
  expect(replyQuestion(...namedIn(world))).toBe(text);
});

Then('the reply question can be kept {string}', (world: ReplyWordsWorld, labels: string) => {
  const choices = rememberChoices(...namedIn(world));
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
  /** What the applets have been told, in order. */
  told?: Array<{ background: string; text: string; primary: string }>;
  /** Fires the signals the shell follows, as the page would when its palette changes. */
  change?: () => void;
  stop?: () => void;
}

/** The signals the page offers: whatever the shell is watching, one trigger to make them all fire. */
const signals = (world: ThemeWorld): ThemeSignal[] => [(onChange) => {
  world.change = onChange;
  return () => void (world.change = undefined);
}];

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

const follow = (world: ThemeWorld, opened: ReturnType<typeof shellTheme>): void => {
  world.told = [];
  world.stop = followShellTheme(signals(world), readToken(world), (theme) => world.told?.push(theme.colors), opened);
};

Given("the shell follows the page's colours", (world: ThemeWorld) => follow(world, shellTheme(readToken(world))));

Given('the shell was started with background {string}, text {string} and primary {string}, and follows the page\'s colours', (world: ThemeWorld, background: string, text: string, primary: string) =>
  follow(world, { colors: { background, text, primary } }));

When("the page's colours change to {string}", (world: ThemeWorld, tokens: string) => {
  for (const pair of tokens.split(';')) {
    const [name, value] = pair.split(':').map((part) => part.trim()) as [string, string];
    world.tokens?.set(name, value);
  }
  world.change?.();
});

When("the page's palette is applied again", (world: ThemeWorld) => {
  world.change?.();
});

Then('the applets were told background {string}, text {string} and primary {string}', (world: ThemeWorld, background: string, text: string, primary: string) => {
  expect(world.told).toEqual([{ background, text, primary }]);
});

Then('the applets were told nothing', (world: ThemeWorld) => {
  expect(world.told).toEqual([]);
});

Then("the shell stops following the page's colours", (world: ThemeWorld) => {
  world.stop?.();
  world.stop = undefined;
});

Then('no signal is left listening', (world: ThemeWorld) => {
  expect(world.change).toBeUndefined();
});

Then('an applet at {string} published by {string} is said to be {string}', (_world: unknown, address: string, publisher: string, words: string) => {
  expect(publisherWords({ address, publisher })).toBe(words);
});

Then('the shell explains the tool search refusal {string} as {string}', (_world: WordsWorld, reason: string, text: string) => {
  expect(toolSearchWords(new Error(reason))).toBe(text);
});

Then('the shell explains a tool search that threw something other than an error as {string}', (_world: WordsWorld, text: string) => {
  expect(toolSearchWords('nope')).toBe(text);
});

Then('the shell stores the helper {string} named {string} with {string} as {string}', (_world: WordsWorld, address: string, username: string, credential: string, json: string) => {
  expect(helperFrom(address, username, credential)).toEqual(JSON.parse(json));
});



