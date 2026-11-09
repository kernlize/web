/** Exact reasons first, then reason prefixes; anything else gets one generic sentence, never the raw reason. */
const ERRORS: Readonly<Record<string, string>> = {
  'invalid:pointer': 'That does not look like an applet address.',
  'invalid:unresolved': 'The applet could not be prepared. Look it up again.',
  'invalid:frame-detached': 'The applet window closed before the applet could start.',
  'unavailable:preview-offline': 'The preview runs offline. Pick one of the applets in the store.',
  'unavailable:manifest': 'No applet was found at that address. Check it and try again.',
  'unavailable:blob': 'The applet was found, but its file could not be downloaded right now. Try again later.',
  'unavailable:frame-lock': 'This applet could not be sealed safely, so the shell did not open it.',
  'denied:blocked': 'You blocked this applet. Unblock it from its grants first.',
  'denied:signed-out': 'Sign in to open applets.',
};

const PREFIXES: readonly (readonly [string, string])[] = [
  ['invalid:', "This applet did not pass the shell's checks, so it was not opened."],
  ['unavailable:', 'The applet cannot be reached right now. Try again later.'],
  ['denied:', 'The shell refused to open this applet.'],
  ['timeout', 'Looking up the applet took too long. Try again.'],
];

/** What the launcher says when it gets no reason it recognises. */
export const GENERIC_LAUNCH_ERROR = 'Could not open the applet. Try again, or try another address.';

/** Plain words for why an applet could not be found, verified or opened (D-006). */
export function explainLaunchError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const code = message.split(' ', 1)[0] as string;
  return ERRORS[message] ?? ERRORS[code] ?? PREFIXES.find(([prefix]) => code.startsWith(prefix))?.[1] ?? GENERIC_LAUNCH_ERROR;
}
