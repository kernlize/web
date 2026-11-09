const WORDING: ReadonlyArray<readonly [RegExp, string]> = [
  [/invalid:recipient/, 'That does not look like an account id.'],
  [/unavailable:no-default-provider/, "Turn on a provider in the shell's settings first."],
  [/unavailable:recipient-not-ready/, 'This person cannot be reached that way yet.'],
  [/(?:^|[\s:])denied:/, 'Not sent.'],
];

const FALLBACK = 'That did not work. Try again.';

/** The text of whatever a rejected call threw. */
export function failureReason(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/** Plain words for a refused send. The raw reason is never shown. */
export function sendFailureText(reason: string): string {
  const match = WORDING.find(([pattern]) => pattern.test(reason));
  return match ? match[1] : FALLBACK;
}

/**
 * The injected binding gives up waiting for an answer after a fixed interval,
 * but the shell may still be asking the person a question and send afterwards.
 * That outcome is unknown rather than a refusal.
 */
export function isUnansweredSend(reason: string): boolean {
  return /\btimed out$/.test(reason);
}

/** The line under a bubble that was refused. */
export function failedSendNote(problem: string): string {
  return problem === 'Not sent.' ? problem : `Not sent. ${problem}`;
}
