export interface RetryPolicy {
  /** How long one attempt may stay unanswered before the next one starts. */
  timeoutMs: number;
  retries: number;
  /** Wait before the first retry; doubled for each one after it. */
  backoffMs: number;
}

export interface Timers {
  set(run: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const systemTimers: Timers = {
  set: (run, delayMs) => globalThis.setTimeout(run, delayMs),
  clear: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * True when the shell never dealt with a request: its guard refused it
 * (`firewall:`) or dropped it, which only shows as the binding giving up.
 */
export function wasDropped(error: unknown): boolean {
  const reason = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return reason.startsWith('firewall:') || reason.endsWith(' timed out');
}

interface Options<T> {
  policy: RetryPolicy;
  timers?: Timers;
  /** A result that arrived after another attempt had already won. */
  discard?: (value: T) => void;
  /** An attempt went unanswered or was refused: the shell is over budget. */
  dropped?: () => void;
}

/**
 * Repeat a read the shell may have dropped. `attempt` calls `started` when its
 * request actually leaves, so time spent queued does not count against it.
 *
 * An attempt that goes quiet is not abandoned: a slow shell may still answer
 * it, and the first answer from any attempt wins. A real refusal ends the read
 * at once. Only for calls that are safe to make twice.
 */
export function withRetry<T>(attempt: (started: () => void) => Promise<T>, options: Options<T>): Promise<T> {
  const { policy, timers = systemTimers } = options;
  return new Promise<T>((resolve, reject) => {
    const handles = new Set<unknown>();
    let launched = 0;
    let done = false;

    const later = (run: () => void, delayMs: number): unknown => {
      const handle = timers.set(() => {
        handles.delete(handle);
        if (!done) run();
      }, delayMs);
      handles.add(handle);
      return handle;
    };
    const finish = (settle: () => void): void => {
      if (done) return;
      done = true;
      for (const handle of handles) timers.clear(handle);
      settle();
    };
    const giveUpOn = (error: unknown): void => {
      options.dropped?.();
      if (launched > policy.retries) finish(() => reject(error));
      else later(launch, policy.backoffMs * 2 ** (launched - 1));
    };
    function launch(): void {
      launched += 1;
      let quiet = false;
      let watch: unknown;
      const started = (): void => {
        watch = later(() => {
          quiet = true;
          giveUpOn(new Error('timed out'));
        }, policy.timeoutMs);
      };
      attempt(started).then(
        (value) => (done ? options.discard?.(value) : finish(() => resolve(value))),
        (error: unknown) => {
          timers.clear(watch);
          handles.delete(watch);
          if (done) return;
          if (!wasDropped(error)) finish(() => reject(error));
          else if (!quiet) giveUpOn(error);
        },
      );
    }
    launch();
  });
}
