import type { MailboxState, PublishOutcome, RelayDirectory } from '@kernlize/core';
import { serverAddress, serverName } from './servers';

/** The inbox and outbox as Settings edits them, before they are saved. */
export interface MailboxDraft {
  readonly inboxes: readonly string[];
  readonly outboxes: readonly string[];
}

export type MailboxSide = keyof MailboxDraft;

/** A server offered to the person: the address in data, the name on screen (D-006). */
export interface ServerChoice {
  readonly url: string;
  readonly label: string;
}

const PURPOSE = { inboxes: 'inbox', outboxes: 'outbox' } as const;
const COMPLETIONS = 6;
const SUGGESTIONS = 3;
const ADDRESS = /^wss?:\/\/[^\s/.]+\.[^\s]+$/i;

/** The server's name, with its path when it has one, so two lists on one host read apart (`example.com/inbox`). */
const labelOf = (url: string): string => {
  const { pathname } = new URL(url);
  return pathname === '/' ? serverName(url) : `${serverName(url)}${pathname.replace(/\/$/, '')}`;
};

const choice = (url: string): ServerChoice => ({ url, label: labelOf(url) });

/** One spelling per server, as the core stores it: lower-case host and a path, so `wss://nos.lol` and `wss://NOS.lol/` are one. */
const canonical = (url: string): string => new URL(url).href;

/**
 * What Settings starts editing from: the published list when there is one, the suggestions when
 * the account has none, and nothing while the shell is still looking.
 */
export function draftOf(state: MailboxState): MailboxDraft | undefined {
  if (state.status === 'loading') return undefined;
  const { inboxes, outboxes } = state.status === 'found' ? state.mailboxes : state.suggested;
  return { inboxes: [...new Set(inboxes.map(canonical))], outboxes: [...new Set(outboxes.map(canonical))] };
}

/** The draft with one more server on one side. Throws `invalid:relay-url` for something that is not a server address. */
export function withServer(draft: MailboxDraft, side: MailboxSide, input: string): MailboxDraft {
  const typed = serverAddress(input);
  if (!ADDRESS.test(typed)) throw new Error('invalid:relay-url');
  const url = canonical(typed);
  return draft[side].some((entry) => canonical(entry) === url) ? draft : { ...draft, [side]: [...draft[side], url] };
}

/** The draft without one server on one side. */
export function withoutServer(draft: MailboxDraft, side: MailboxSide, url: string): MailboxDraft {
  return { ...draft, [side]: draft[side].filter((entry) => entry !== url) };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => {
  const other = new Set(b.map(canonical));
  return a.length === other.size && a.every((url) => other.has(canonical(url)));
};

/** Whether there is something to save: always when nothing is published yet, otherwise when a side differs. */
export function draftChanged(draft: MailboxDraft, state: MailboxState): boolean {
  if (state.status !== 'found') return true;
  return !sameList(draft.inboxes, state.mailboxes.inboxes) || !sameList(draft.outboxes, state.mailboxes.outboxes);
}

/** Monitored servers whose address matches what the person is typing, for the field's completion list. */
export function completionsFor(directory: RelayDirectory, text: string, exclude: readonly string[]): readonly ServerChoice[] {
  if (text.trim().length < 2) return [];
  return directory
    .search(text.trim(), COMPLETIONS + exclude.length)
    .filter((listing) => !exclude.includes(listing.url))
    .slice(0, COMPLETIONS)
    .map((listing) => choice(listing.url));
}

/** A few well-monitored servers this side does not have yet. */
export function suggestionsFor(directory: RelayDirectory, side: MailboxSide, draft: MailboxDraft): readonly ServerChoice[] {
  return directory.suggest({ purpose: PURPOSE[side], exclude: draft[side], limit: SUGGESTIONS }).map((listing) => choice(listing.url));
}

/** A save still under way: how many servers hold the list so far. */
export function progressWords(sofar: PublishOutcome): string {
  const held = sofar.accepted.length;
  return held === 0 ? 'Publishing…' : `Saved to ${held} ${held === 1 ? 'server' : 'servers'} so far…`;
}

/** What a save did, in words: how many servers took the list, never their protocol messages. */
export function savedWords(outcome: PublishOutcome, describe: (outcome: PublishOutcome) => string): string {
  return outcome.ok ? describe(outcome) : `${describe(outcome)}. Your list is unchanged; try again or pick other servers.`;
}
