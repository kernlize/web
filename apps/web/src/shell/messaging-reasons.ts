/**
 * Plain words for every reason messaging can give. The unavailability keys are the codes
 * `MESSAGING_UNAVAILABLE_REASONS` in `@kernl/core` hands out (plus the preview's own); a browser
 * test checks that every core code has an entry here, so a new code cannot reach a person raw.
 * The core is not imported at runtime: the shell loads it on demand, and the preview never does.
 */
export const UNAVAILABLE_WORDS: Readonly<Record<string, string>> = {
  'needs-local-key-signer': 'No backend is available for this provider yet.',
  'not-implemented': 'No backend is available for this provider yet; it is not built into the shell.',
  'no-runtime': 'No backend is available for this provider yet; this build lacks the part it needs.',
  'no-ratchet-runtime': 'No backend is available for this provider yet; this build lacks the part it needs.',
};

/** Plain words for the reasons a send, an enable or a disable can be refused with. */
const ERROR_WORDS: Readonly<Record<string, string>> = {
  'unavailable:no-default-provider': 'Turn on a provider first.',
  'unavailable:offline': 'The message could not be sent right now.',
  'invalid:unknown-conversation': 'That conversation no longer exists.',
  'invalid:no-recipients': 'Add someone to write to.',
  'invalid:unknown-provider': 'That provider is not part of this shell.',
  'invalid:provider-not-enabled': 'Turn that provider on first.',
};

/** Why a provider cannot be used, in plain words; an unknown code gets a generic sentence. */
export function unavailableWhy(reason: string): string {
  return UNAVAILABLE_WORDS[reason] ?? 'No backend is available for this provider yet.';
}

/** A refused messaging action in plain words. The raw reason is never shown. */
export function messagingError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const [code = ''] = message.split(' ');
  const known = ERROR_WORDS[code];
  if (known) return known;
  if (code.startsWith('unavailable:')) return unavailableWhy(code.slice('unavailable:'.length));
  return 'That did not work. Try again.';
}
