/**
 * Words a person must never read in the shell (DECISIONS D-006): protocol names, key and address
 * encodings, and remote-signer jargon. A relay is called a relay (D-051), so that word is not
 * here. The browser vocabulary test imports this same pattern, so what the shell avoids and what
 * the test rejects cannot drift apart.
 */
export const DENIED_WORDS = /\b(accounts?|nostr|nip-?\d+|napplets?|pubkeys?|npub\w*|nsec\w*|naddr\w*|nevent\w*|bunker)\b/i;

/** Whether a piece of visible text would name the protocol underneath. */
export function namesProtocol(text: string): boolean {
  return DENIED_WORDS.test(text);
}

/**
 * A host name as the shell shows one, with a scheme, port and path when it has them: lower-case
 * labels joined by dots, ending in a top-level label of letters, which is captured. The
 * lookbehind keeps a match from starting inside a longer word.
 */
const ADDRESS = /(?<![\w.-])(?:[a-z][a-z0-9+-]*:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,})(?::\d+)?(?:\/[^\s,;)]*)?/g;

/**
 * Text with every address blanked. A relay is shown by its own host (D-051), and a host can
 * contain a denied word (`relay.nostr.band`); the vocabulary check reads what is left, so the
 * shell's own words are still held to the list while an address is never hidden to pass it.
 * Two words run together by a full stop are not an address when the second is capitalised or
 * is itself a denied word, so a sentence cannot hide one that way.
 */
export function withoutAddresses(text: string): string {
  return text.replace(ADDRESS, (address: string, top: string) => (namesProtocol(top) ? address : ' '));
}
