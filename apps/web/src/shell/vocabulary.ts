/**
 * Words a person must never read in the shell or on the site (DECISIONS D-006): protocol names,
 * key and address encodings, and remote-signer jargon. The browser vocabulary test imports this
 * same pattern, so what the shell avoids and what the test rejects cannot drift apart.
 */
export const DENIED_WORDS = /\b(nostr|nip-?\d+|napplets?|relays?|pubkeys?|npub\w*|nsec\w*|naddr\w*|nevent\w*|bunker)\b/i;

/** Whether a piece of visible text would name the protocol underneath. */
export function namesProtocol(text: string): boolean {
  return DENIED_WORDS.test(text);
}
