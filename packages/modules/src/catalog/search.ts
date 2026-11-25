import type { CatalogEntry } from './entry.js';

/** What the store filters by. Every part is optional; an empty query lists everything. */
export interface CatalogQuery {
  /** Free text, matched loosely against title, topics, roles, description and publisher. */
  readonly text?: string;
  /** Topics the entry must carry, all of them. */
  readonly topics?: readonly string[];
  /** When given, entries that require a domain outside this list are left out. */
  readonly available?: readonly string[];
  /** When given, only entries that accept this convention identity, such as `napplet:profile/open`. */
  readonly convention?: string;
}

/** A topic and how many listed applets carry it. */
export interface TopicCount {
  readonly topic: string;
  readonly count: number;
}

const FIELD_WEIGHTS = { title: 8, topics: 5, archetypes: 5, description: 2, publisher: 1 } as const;

/**
 * How well one search word matches a field: a whole-word hit beats a prefix,
 * a prefix beats a substring, and a substring beats the word's letters
 * appearing in order within one word of the field, which forgives a typo
 * without letting a long description match anything. Zero when none hold.
 *
 * @param word - One lower-case search word.
 * @param field - Lower-case field text.
 * @returns A score from 0 to 4.
 * @example
 * ```ts
 * fuzzyScore('chess', 'chess club'); // 4
 * fuzzyScore('chss', 'chess club'); // 1
 * ```
 */
export function fuzzyScore(word: string, field: string): number {
  if (word === '' || field === '') return 0;
  const words = field.split(/[^\p{L}\p{N}]+/u);
  if (words.includes(word)) return 4;
  if (words.some((part) => part.startsWith(word))) return 3;
  if (field.includes(word)) return 2;
  return word.length > 2 && words.some((part) => inOrder(word, part)) ? 1 : 0;
}

/** Whether every letter of `word` appears in `part`, in order: "mnswpr" in "minesweeper". */
function inOrder(word: string, part: string): boolean {
  let at = 0;
  for (const char of part) if (char === word[at]) at += 1;
  return at === word.length;
}

function wordScore(word: string, entry: CatalogEntry): number {
  const fields: Record<keyof typeof FIELD_WEIGHTS, string> = {
    title: entry.title.toLowerCase(),
    topics: entry.topics.join(' '),
    archetypes: entry.archetypes.join(' '),
    description: entry.description.toLowerCase(),
    publisher: entry.publisher,
  };
  let best = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    best = Math.max(best, fuzzyScore(word, fields[field as keyof typeof FIELD_WEIGHTS]) * weight);
  }
  return best;
}

function textScore(text: string, entry: CatalogEntry): number {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  let total = 0;
  for (const word of words) {
    const score = wordScore(word, entry);
    if (score === 0) return 0;
    total += score;
  }
  return words.length === 0 ? 1 : total;
}

function passesFilters(entry: CatalogEntry, query: CatalogQuery): boolean {
  if (query.topics?.some((topic) => !entry.topics.includes(topic))) return false;
  if (query.available && entry.requires.some((domain) => !query.available?.includes(domain))) return false;
  return query.convention === undefined || entry.conventions.includes(query.convention);
}

/**
 * Filter and rank store entries.
 *
 * Every search word has to match some field; entries are ordered by score,
 * then by how recently they were published.
 *
 * @param entries - The listed applets.
 * @param query - Text, topics, the domains the shell offers and an optional convention.
 * @returns Matching entries, best first.
 * @example
 * ```ts
 * searchCatalog(entries, { text: 'mine swep', topics: ['game'], available: kernl.grants.availableDomains() });
 * ```
 */
export function searchCatalog(entries: readonly CatalogEntry[], query: CatalogQuery = {}): readonly CatalogEntry[] {
  const scored: Array<{ entry: CatalogEntry; score: number }> = [];
  for (const entry of entries) {
    if (!passesFilters(entry, query)) continue;
    const score = textScore(query.text ?? '', entry);
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score || b.entry.publishedAt - a.entry.publishedAt);
  return Object.freeze(scored.map(({ entry }) => entry));
}

/**
 * The topics most listed applets carry, for the store's filter bubbles.
 *
 * @param entries - The listed applets.
 * @param limit - How many topics to return.
 * @returns Topics by count, then alphabetically.
 * @example
 * ```ts
 * popularTopics(entries, 3); // [{ topic: 'game', count: 14 }, { topic: '3d', count: 5 }, …]
 * ```
 */
export function popularTopics(entries: readonly CatalogEntry[], limit = 12): readonly TopicCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) for (const topic of entry.topics) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  return Object.freeze(
    [...counts]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
      .slice(0, limit),
  );
}
