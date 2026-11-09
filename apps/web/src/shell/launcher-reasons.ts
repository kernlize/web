/**
 * Plain words for every reason opening an applet can fail with. Exact reasons first, then reason
 * prefixes. The raw reason is never shown (D-006); one the shell has no words for is reported as
 * unexpected so the launcher can leave it in the console, where a bug can be read instead of guessed.
 */
const ERRORS: Readonly<Record<string, string>> = {
  'invalid:pointer': 'That does not look like an applet address.',
  'invalid:unresolved': 'The applet could not be prepared. Look it up again.',
  'invalid:frame-detached': 'The applet window closed before the applet could start.',
  'invalid:domain': 'This shell cannot provide something that was switched on for this applet. Look it up again.',
  'unavailable:preview-offline': 'The preview runs offline. Pick one of the applets in the store.',
  'unavailable:manifest': 'No applet was found at that address. Check it and try again.',
  'unavailable:network': 'None of the servers that list applets could be reached. Check your connection and try again.',
  'unavailable:blob': 'The applet was found, but its file could not be downloaded right now. Try again later.',
  'unavailable:frame-lock': 'This applet could not be sealed safely, so the shell did not open it.',
  'invalid:artifact-hash': 'The copy of this applet that came with the shell is damaged. Reload the page and try again.',
  'denied:blocked': 'You blocked this applet. Unblock it from its grants first.',
  'denied:signed-out': 'Sign in to open applets.',
};

const PREFIXES: readonly (readonly [string, string])[] = [
  ['invalid:', 'This applet did not pass the shell\'s checks, so it was not opened.'],
  ['unavailable:', 'The applet cannot be reached right now. Try again later.'],
  ['denied:', 'The shell refused to open this applet.'],
  ['timeout', 'Looking up the applet took too long. Try again.'],
];

const GENERIC = 'Could not open the applet. Try again, or try another address.';

/** What the launcher says, and whether the shell knew the reason. */
export interface OpenFailure {
  readonly words: string;
  /** False for a failure the shell has no reason code for: a bug to read in the console, not a state to explain. */
  readonly expected: boolean;
}

/** A failed lookup or run in plain words. */
export function openFailure(reason: unknown): OpenFailure {
  const message = reason instanceof Error ? reason.message : String(reason);
  const [code = ''] = message.split(' ');
  const words = ERRORS[message] ?? ERRORS[code] ?? PREFIXES.find(([prefix]) => code.startsWith(prefix))?.[1];
  return words === undefined ? { words: GENERIC, expected: false } : { words, expected: true };
}

/**
 * The words the store, the applet summary and the handler chooser show for a failure. A reason the
 * shell has no words for is a defect, so it goes to the console, where the sentence cannot say it.
 */
export function explainOpenFailure(reason: unknown, warn: (message: string, reason: unknown) => void = console.warn): string {
  const failure = openFailure(reason);
  if (!failure.expected) warn('kernl: an applet could not be opened for an unexpected reason', reason);
  return failure.words;
}
