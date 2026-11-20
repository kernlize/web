import type { AppletStopDetails, AppletStopLimit } from './contract';

/** Who set a stop in motion. */
export type StopCause = 'applet' | 'you' | 'shell';

/** Why an applet stopped, as its window and its notice show it. */
export interface StopReport {
  /** One line: what happened. */
  readonly words: string;
  /** Who set it off, when that is known. */
  readonly by?: StopCause;
  /** What to do about it. */
  readonly next: string;
  /** The guard limit crossed, as "300 messages in 10 s · strict". */
  readonly limit?: string;
  /** The stable code the core reported, for a bug report. */
  readonly code: string;
  /** kehto's own diagnostic line, when kehto stopped it. */
  readonly detail?: string;
  /** When it stopped, in milliseconds since the epoch. */
  readonly at: number;
}

interface StopWords {
  readonly words: string;
  readonly by?: StopCause;
  readonly next: string;
}

const AGAIN = 'Reload it.';
const BUG = 'Reload it. If it repeats, the applet has a bug.';

// kehto's codes are its `NappletRevocationReason`; the others are kernl's own.
const STOPS: Readonly<Record<string, StopWords>> = {
  quarantine: { words: 'It sent too many messages.', by: 'applet', next: 'Reload it, or loosen the guard profile.' },
  host: { words: 'The shell closed it.', by: 'shell', next: AGAIN },
  'grant-narrowed': { words: 'You took back something it was using.', by: 'you', next: 'Reload it to run it with what it may use now.' },
  blocked: { words: 'You blocked it.', by: 'you', next: 'Unblock it in its grants to run it.' },
  firewall: { words: 'A firewall rule or answer it ran under changed.', by: 'you', next: AGAIN },
  'window-message': { words: 'It sent a message outside its channel.', by: 'applet', next: BUG },
  'second-hello': { words: 'It tried to connect to the shell twice.', by: 'applet', next: BUG },
  'invalid-hello': { words: 'It connected to the shell the wrong way.', by: 'applet', next: BUG },
  'second-load': { words: 'It reloaded or left its own page.', by: 'applet', next: AGAIN },
  'port-closed': { words: 'Its connection to the shell closed.', next: AGAIN },
  'deferred-overflow': { words: 'It sent too much while waiting to be seen.', by: 'applet', next: AGAIN },
};

const HIDDEN_FETCHES: StopWords = { words: 'It kept fetching from the web while hidden.', by: 'applet', next: AGAIN };
const UNKNOWN: StopWords = { words: 'It was stopped for a reason the shell does not know.', next: AGAIN };

/** "300 messages in 10 s · strict", or "8 web fetches while hidden · strict". */
export function describeLimit(limit: AppletStopLimit): string {
  const what = limit.windowMs === undefined ? `${limit.count} web fetches while hidden` : `${limit.count} messages in ${limit.windowMs / 1000} s`;
  return `${what} · ${limit.profile}`;
}

/**
 * Plain words for a stop: one line of what happened, who set it off and what helps, with the
 * code and kehto's detail kept for a bug report. A code the shell does not know is still shown.
 *
 * @param code - The reason the core reported.
 * @param details - What else the core knew.
 * @param at - When it stopped.
 * @returns The report the window and the notice show.
 * @example
 * ```ts
 * describeStop('window-message', { detail: 'A window-level message…' }, Date.now()).words; // 'It sent a message outside its channel.'
 * ```
 */
export function describeStop(code: string, details: AppletStopDetails | undefined, at: number): StopReport {
  const limit = details?.limit;
  const known = limit?.cause === 'hidden-resource' ? HIDDEN_FETCHES : (STOPS[code] ?? UNKNOWN);
  return {
    ...known,
    code,
    at,
    ...(limit ? { limit: describeLimit(limit) } : {}),
    ...(details?.detail ? { detail: details.detail } : {}),
  };
}
