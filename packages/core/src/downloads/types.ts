import type { ServiceHandler } from '@kehto/runtime';
import type { AppletIdentity, StorageLike } from '../types.js';

/** One line of what the person is shown before a download service acts for an applet. */
export interface DownloadQuestionLine {
  readonly label: string;
  readonly value: string;
}

/**
 * What a download service puts to the person before it acts for an applet. Words only:
 * no address, path, credential or raw backend id belongs in a line.
 */
export interface DownloadQuestion {
  /** Which decision this is, so the host can word and rank it. */
  readonly kind: 'add' | 'session' | 'delete';
  readonly title: string;
  readonly lines: readonly DownloadQuestionLine[];
}

/** What every download service needs from the shell. */
export interface DownloadServiceDeps {
  /** The verified applet a window runs, or undefined when the window is not a live applet. */
  readonly appletOf: (windowId: string) => AppletIdentity | undefined;
  /** Put a question to the person in the name of a window's applet; resolves true only on yes. */
  readonly ask: (windowId: string, question: DownloadQuestion) => Promise<boolean>;
  /** Where records that must outlive a window are kept; keys are written under the `kernl` namespace. */
  readonly storage: StorageLike;
  /** Milliseconds since the epoch; `Date.now` by default. */
  readonly now?: () => number;
}

/**
 * A download service: the handler kehto dispatches to, plus `dispose`, which stops every
 * timer and forgets every window when the shell is torn down.
 */
export interface DownloadService {
  readonly handler: ServiceHandler;
  dispose(): void;
}
