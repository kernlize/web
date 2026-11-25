import type { SuggestPurpose } from './directory.js';

// Shared by the directory and the mailboxes, which falls back on it when no directory is listed; neither module owns it (D-068).

/**
 * What the directory suggests when it knows nothing, per purpose. General
 * servers for inbox and outbox; servers that index profiles and server lists
 * for lookup.
 *
 * @example
 * ```ts
 * DEFAULT_SUGGESTIONS.lookup; // ['wss://purplepag.es', 'wss://user.kindpag.es', 'wss://indexer.coracle.social']
 * ```
 */
export const DEFAULT_SUGGESTIONS: Readonly<Record<SuggestPurpose, readonly string[]>> = Object.freeze({
  inbox: Object.freeze(['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']),
  outbox: Object.freeze(['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']),
  lookup: Object.freeze(['wss://purplepag.es', 'wss://user.kindpag.es', 'wss://indexer.coracle.social']),
});
