/** Words for the meeting and remote tools settings: what a refused search means, and what a typed helper becomes (D-006). */

const SEARCH_REFUSALS: Readonly<Record<string, string>> = {
  'invalid:tool-reference': 'Enter a shared reference, a tool fingerprint or a website.',
  'unavailable:no-tools': 'No tools were found for that.',
  'invalid:tool-inventory': 'Those tools failed their check, so they are not offered.',
  'unavailable:website': 'That website names no tool server.',
  'unavailable:preview': 'The preview cannot look for tools.',
};

/** Why a search for tools found nothing to trust, in words; anything unexpected reads as a plain failure. */
export function toolSearchWords(error: unknown): string {
  const reason = error instanceof Error ? error.message : '';
  return SEARCH_REFUSALS[reason] ?? 'The search did not work. Try again.';
}

/** A typed connection helper as the shell stores it: the address as typed, and a name and password only when given. */
export function helperFrom(address: string, username: string, credential: string): { urls: string[]; username?: string; credential?: string } {
  return { urls: [address.trim()], ...(username.trim() ? { username: username.trim() } : {}), ...(credential ? { credential } : {}) };
}
