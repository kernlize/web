import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { MailboxState, PublishOutcome, RelayDirectory, RelayListing, SuggestOptions } from '@kernlize/core';
import { completionsFor, draftChanged, draftOf, progressWords, savedWords, suggestionsFor, withoutServer, withServer, type MailboxDraft, type MailboxSide } from '../../src/shell/mailbox-draft.ts';

interface MailboxWorld {
  draft?: MailboxDraft;
  directory?: RelayDirectory;
}

const list = (text: string): string[] => (text === '' ? [] : text.split(',').map((part) => part.trim()));
const EVENT = { kind: 10002, tags: [], content: '', created_at: 0, pubkey: '', id: '', sig: '' };
const found = (inboxes: string, outboxes: string): MailboxState => ({ status: 'found', mailboxes: { inboxes: list(inboxes), outboxes: list(outboxes) }, event: EVENT });
const SIDE: Record<string, MailboxSide> = { inbox: 'inboxes', outbox: 'outboxes' };

function draft(world: MailboxWorld): MailboxDraft {
  if (!world.draft) throw new Error('make a draft first');
  return world.draft;
}

function listing(url: string): RelayListing {
  return { url, monitors: 1, lastSeen: 0, nips: [], types: [], requiresAuth: false, requiresPayment: false, restrictedWrites: false };
}

function fakeDirectory(urls: readonly string[]): RelayDirectory {
  const listings = urls.map(listing);
  return {
    listings$: undefined as never,
    listings: () => listings,
    search: (text, limit = 10) => listings.filter((entry) => entry.url.includes(text)).slice(0, limit),
    suggest: ({ exclude = [], limit = 3 }: SuggestOptions) => listings.filter((entry) => !exclude.includes(entry.url)).slice(0, limit),
    start: () => undefined,
    stop: () => undefined,
  };
}

Then('the draft while looking is empty', () => {
  expect(draftOf({ status: 'loading' })).toBeUndefined();
});

Then('the draft for a missing list is the suggested {string} and {string}, spelled {string} and {string}', (_world: MailboxWorld, inboxes: string, outboxes: string, spelledIn: string, spelledOut: string) => {
  expect(draftOf({ status: 'missing', suggested: { inboxes: list(inboxes), outboxes: list(outboxes) } })).toEqual({ inboxes: list(spelledIn), outboxes: list(spelledOut) });
});

Then('the draft for a found list is its inbox {string} and outbox {string}, spelled {string} and {string}', (_world: MailboxWorld, inboxes: string, outboxes: string, spelledIn: string, spelledOut: string) => {
  expect(draftOf(found(inboxes, outboxes))).toEqual({ inboxes: list(spelledIn), outboxes: list(spelledOut) });
});

Given('a draft with inbox {string} and outbox {string}', (world: MailboxWorld, inboxes: string, outboxes: string) => {
  world.draft = { inboxes: list(inboxes), outboxes: list(outboxes) };
});

When('the person adds {string} to the {word}', (world: MailboxWorld, input: string, side: string) => {
  world.draft = withServer(draft(world), SIDE[side] as MailboxSide, input);
});

When('the person removes {string} from the {word}', (world: MailboxWorld, url: string, side: string) => {
  world.draft = withoutServer(draft(world), SIDE[side] as MailboxSide, url);
});

Then('the draft has inbox {string} and outbox {string}', (world: MailboxWorld, inboxes: string, outboxes: string) => {
  expect(draft(world)).toEqual({ inboxes: list(inboxes), outboxes: list(outboxes) });
});

Then('adding {string} to the {word} is refused with {string}', (world: MailboxWorld, input: string, side: string, reason: string) => {
  expect(() => withServer(draft(world), SIDE[side] as MailboxSide, input)).toThrow(reason);
});

Then('the draft needs saving against a missing list', (world: MailboxWorld) => {
  expect(draftChanged(draft(world), { status: 'missing', suggested: { inboxes: [], outboxes: [] } })).toBe(true);
});

Then('the draft does not need saving against the found list with inbox {string} and outbox {string}', (world: MailboxWorld, inboxes: string, outboxes: string) => {
  expect(draftChanged(draft(world), found(inboxes, outboxes))).toBe(false);
});

Then('the draft needs saving against the found list with inbox {string} and outbox {string}', (world: MailboxWorld, inboxes: string, outboxes: string) => {
  expect(draftChanged(draft(world), found(inboxes, outboxes))).toBe(true);
});

Given('a directory that knows {string}', (world: MailboxWorld, urls: string) => {
  world.directory = fakeDirectory(list(urls));
});

Then('completing {string} offers {string}', (world: MailboxWorld, text: string, labels: string) => {
  expect(completionsFor(world.directory as RelayDirectory, text, []).map((option) => option.label)).toEqual(list(labels));
});

Then('completing {string} without {string} offers {string}', (world: MailboxWorld, text: string, exclude: string, labels: string) => {
  expect(completionsFor(world.directory as RelayDirectory, text, list(exclude)).map((option) => option.label)).toEqual(list(labels));
});

Then('suggestions for the {word} of a draft holding {string} are {string}', (world: MailboxWorld, side: string, held: string, labels: string) => {
  const side_ = SIDE[side] as MailboxSide;
  const holding = { inboxes: [], outboxes: [], [side_]: list(held) } as MailboxDraft;
  expect(suggestionsFor(world.directory as RelayDirectory, side_, holding).map((option) => option.label)).toEqual(list(labels));
});

const describeCount = (outcome: PublishOutcome): string => (outcome.ok ? `${outcome.accepted.length} of ${outcome.accepted.length + outcome.refused.length}` : 'none');

Then('a save accepted by {string} and refused by {string} reads {string}', (_world: MailboxWorld, accepted: string, refused: string, words: string) => {
  const outcome = { accepted: list(accepted), refused: list(refused).map((url) => ({ url, reason: 'blocked' })), ok: true };
  expect(savedWords(outcome, describeCount)).toBe(words);
});

Then('a save refused by {string} reads {string}', (_world: MailboxWorld, refused: string, words: string) => {
  const outcome = { accepted: [], refused: list(refused).map((url) => ({ url, reason: 'blocked' })), ok: false };
  expect(savedWords(outcome, describeCount)).toBe(words);
});

Then('a save under way held by {string} reads {string}', (_world: MailboxWorld, accepted: string, words: string) => {
  expect(progressWords({ accepted: list(accepted), refused: [], ok: accepted !== '' })).toBe(words);
});
