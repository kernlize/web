/** Words for the meeting and remote tools settings: what a refused search means, and what a typed helper becomes (D-006). */

const SEARCH_REFUSALS: Readonly<Record<string, string>> = {
  'invalid:tool-reference': 'Enter a reference to tools someone shared, a 64-character tool fingerprint, or a website address.',
  'unavailable:no-tools': 'No tools were found for that.',
  'invalid:tool-inventory': 'The tools found do not match what they say they are, so they are not offered.',
  'unavailable:website': 'That website does not say which tool server it runs.',
  'unavailable:preview': 'The preview reaches no network, so it cannot look for tools.',
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
