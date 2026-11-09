/** `urgent` runs before anything waiting; `background` only when nothing else has run lately. */
export type Lane = 'urgent' | 'normal' | 'background';

export interface PacerOptions {
  /** Most calls that may start inside any one window. */
  limit: number;
  windowMs: number;
  /** A background call starts only while fewer calls than this started in the window. */
  backgroundLimit: number;
  /** The limit while slowed down after the shell dropped or refused something. */
  slowLimit: number;
  now(): number;
  /** Run `pump` again after `delayMs`. */
  wake(delayMs: number, pump: () => void): void;
}

export interface Pacer {
  /** Queue a call; the promise settles with whatever the call does once it has run. */
  schedule<T>(lane: Lane, call: () => T | Promise<T>): Promise<T>;
  /**
   * The shell just dropped or refused a request, so its budget is smaller
   * than assumed (an unfocused window gets a quarter). Hold to `slowLimit`
   * for `durationMs` so its allowance can recover.
   */
  slowDown(durationMs: number): void;
  waiting(): number;
}

interface Task {
  run(): void;
}

/**
 * Spaces out calls to the shell. The shell drops, without a reply, whatever an
 * applet sends over its budget, so nothing may leave in a burst.
 *
 * A token bucket of capacity N refilled at N per window still lets almost 2N
 * through in one window (the burst plus the refill). This counts the calls
 * that started in the trailing window instead, which is the stricter rule the
 * budget needs: never more than `limit` in any rolling window. Within a lane
 * the order is first in, first out.
 */
export function createPacer(options: PacerOptions): Pacer {
  const queues: Record<Lane, Task[]> = { urgent: [], normal: [], background: [] };
  const starts: number[] = [];
  let armed = false;
  let slowUntil = Number.NEGATIVE_INFINITY;

  function next(now: number): Task | undefined {
    const limit = now < slowUntil ? options.slowLimit : options.limit;
    if (starts.length >= limit) return undefined;
    const task = queues.urgent.shift() ?? queues.normal.shift();
    if (task) return task;
    return starts.length < options.backgroundLimit ? queues.background.shift() : undefined;
  }

  function waiting(): number {
    return queues.urgent.length + queues.normal.length + queues.background.length;
  }

  function pump(): void {
    const now = options.now();
    while (starts.length > 0 && starts[0] <= now - options.windowMs) starts.shift();
    for (let task = next(now); task; task = next(now)) {
      starts.push(now);
      task.run();
    }
    if (armed || waiting() === 0 || starts.length === 0) return;
    armed = true;
    const slotFrees = starts[0] + options.windowMs - now;
    const slowEnds = now < slowUntil ? slowUntil - now : slotFrees;
    options.wake(Math.max(1, Math.min(slotFrees, slowEnds)), () => {
      armed = false;
      pump();
    });
  }

  return {
    schedule<T>(lane: Lane, call: () => T | Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queues[lane].push({
          run() {
            try {
              resolve(call());
            } catch (error) {
              reject(error);
            }
          },
        });
        pump();
      });
    },
    slowDown(durationMs) {
      slowUntil = Math.max(slowUntil, options.now() + durationMs);
    },
    waiting,
  };
}
