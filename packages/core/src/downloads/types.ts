import type { DownloadQuestion, AppletIdentity, StorageLike } from '@kernlize/kernel';
export type { DownloadQuestion, DownloadQuestionLine } from '@kernlize/kernel';
import type { ServiceHandler } from '@kehto/runtime';



/** What every download service needs from the shell. */
export interface DownloadServiceDeps {
  /** The verified applet a window runs, or undefined when the window is not a live applet. */
  readonly appletOf: (windowId: string) => AppletIdentity | undefined;
  /**
   * The key what a window's applet starts is kept under: its catalogue id, the same across
   * versions and never shared by another publisher's applet with the same name. Undefined when
   * the window is not a live applet.
   */
  readonly ownerOf: (windowId: string) => string | undefined;
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
