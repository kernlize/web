import type { CatalogEntry, HandlerPrompt } from './contract';
import { domainLabel } from './domains';

/** An encoded address anywhere in the text, as the core's `decodePointer` finds it: pasted bare, behind `nostr:`, in a link or in a sentence. */
const SHARED_ADDRESS = /(?:naddr|nevent|note)1[02-9ac-hj-np-z]{20,}/i;
const HEX_64 = /^[0-9a-f]{64}$/i;
const COORDINATE = /^(?:\d+:[0-9a-f]{64}|[0-9a-f]{64}:\d+):\S*$/i;
const PREVIEW_ADDRESS = /^preview:[a-z0-9-]+$/i;

/**
 * Whether what the person typed into the store's search is an applet address
 * rather than words, so the store offers to open it. Pasting an address always
 * works, whatever else the store shows, including one copied as a share link.
 */
export function looksLikeAddress(text: string): boolean {
  const value = text.trim();
  return SHARED_ADDRESS.test(value) || HEX_64.test(value) || COORDINATE.test(value) || PREVIEW_ADDRESS.test(value);
}

/** A topic bubble: its name, how many listed applets carry it, and whether it is filtering. */
export interface TopicBubble {
  readonly topic: string;
  readonly count: number;
  readonly on: boolean;
}

/** The popular topics, with any selected topic kept in front even when it is not popular. */
export function topicBubbles(popular: readonly { topic: string; count: number }[], selected: readonly string[]): TopicBubble[] {
  const counts = new Map(popular.map(({ topic, count }) => [topic, count]));
  const chosen = selected.map((topic) => ({ topic, count: counts.get(topic) ?? 0, on: true }));
  return [...chosen, ...popular.filter(({ topic }) => !selected.includes(topic)).map(({ topic, count }) => ({ topic, count, on: false }))];
}

/** Add a topic to the filter, or take it out when it is already there. */
export function toggleTopic(selected: readonly string[], topic: string): string[] {
  return selected.includes(topic) ? selected.filter((entry) => entry !== topic) : [...selected, topic];
}

/** What a listed applet needs that this shell does not offer, in plain words. Empty when it can run fully. */
export function missingDomains(entry: Pick<CatalogEntry, 'requires'>, available: readonly string[]): string[] {
  return entry.requires.filter((domain) => !available.includes(domain)).map(domainLabel);
}

/** `text-editor` reads as "text editor". */
const words = (slug: string): string => slug.replace(/[-_]+/g, ' ');
const article = (noun: string): string => (/^[aeiou]/i.test(noun) ? 'an' : 'a');

/** "Notes wants to open a profile." */
export function requestWords(prompt: Pick<HandlerPrompt, 'source' | 'action' | 'archetype'>): string {
  const thing = words(prompt.archetype);
  return `${prompt.source} wants to ${words(prompt.action)} ${article(thing)} ${thing}.`;
}

/** The label for remembering a choice: "Always use it to open a profile". */
export function rememberWords(prompt: Pick<HandlerPrompt, 'action' | 'archetype'>): string {
  const thing = words(prompt.archetype);
  return `Always use it to ${words(prompt.action)} ${article(thing)} ${thing}`;
}

/** What a role means to a person: "profile" becomes "Profiles", "text-editor" becomes "Text editors". */
export function roleWords(archetype: string): string {
  const thing = words(archetype);
  return `${thing.charAt(0).toUpperCase()}${thing.slice(1)}${thing.endsWith('s') ? '' : 's'}`;
}

/** Conventions an entry accepts, as the actions a person recognises: "open a profile, edit a profile". */
export function acceptsWords(conventions: readonly string[]): string {
  return conventions
    .map((convention) => /^napplet:([^/]+)\/(.+)$/.exec(convention))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => {
      const thing = words(match[1] as string);
      return `${words(match[2] as string)} ${article(thing)} ${thing}`;
    })
    .join(', ');
}
