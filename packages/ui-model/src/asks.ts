import { BehaviorSubject, distinctUntilChanged, map, type Observable } from 'rxjs';
import { ASK_KINDS, ASK_REFUSALS, type Ask, type AskAnswer, type AskKind, type AskRenderer, type AskRenderers } from '@kernlize/kernel/asks';

interface Waiting<K extends AskKind> {
  readonly ask: Ask<K>;
  readonly settle: (answer: AskAnswer<K>) => void;
}

/**
 * Questions of one kind, or of several a host draws in one place, waiting to be shown one at a
 * time in arrival order. The one in front is what the host shows.
 */
export interface AskQueue<K extends AskKind> {
  /** Every waiting ask, the one in front first, as the queue changes. */
  readonly waiting$: Observable<readonly Ask<K>[]>;
  /** The ask in front, or undefined when nothing waits. */
  readonly current$: Observable<Ask<K> | undefined>;
  waiting(): readonly Ask<K>[];
  current(): Ask<K> | undefined;
  /**
   * Put an ask in line. Resolves with the person's answer, or with the kind's refusal when its
   * window is revoked or the kernel withdraws it first. A renderer for the kind is this function.
   */
  enqueue(ask: Ask<K>): Promise<AskAnswer<K>>;
  /** Answer the ask in front; the next one comes forward. Does nothing when nothing waits. */
  answer(answer: AskAnswer<K>): void;
  /** Answer every waiting ask from a window with its refusal: the window was revoked. */
  dismissWindow(windowId: string): void;
  /** The waiting asks a window raised. */
  forWindow(windowId: string): readonly Ask<K>[];
}

const asksOf = <K extends AskKind>(list: readonly Waiting<K>[]): readonly Ask<K>[] => list.map((waiting) => waiting.ask);

/**
 * A queue of asks, shown one at a time in arrival order (D-067). An ask whose `signal` aborts
 * leaves the queue with its refusal, as one from a window the host dismisses does.
 *
 * @returns An empty queue.
 * @example
 * ```ts
 * const consent = createAskQueue<'sign.replace' | 'upload.file'>();
 * consent.current$.subscribe((ask) => draw(ask?.defaultText));
 * const host = { ...rest, asks: createAskRenderers({ 'sign.replace': consent, 'upload.file': consent }) };
 * ```
 */
export function createAskQueue<K extends AskKind>(): AskQueue<K> {
  const state = new BehaviorSubject<readonly Waiting<K>[]>([]);
  const remove = (waiting: Waiting<K>, answer: AskAnswer<K>): void => {
    state.next(state.value.filter((other) => other !== waiting));
    waiting.settle(answer);
  };
  const refusalOf = (ask: Ask<K>): AskAnswer<K> => ASK_REFUSALS[ask.kind] as AskAnswer<K>;
  return {
    waiting$: state.pipe(map(asksOf)),
    current$: state.pipe(map((list) => list[0]?.ask), distinctUntilChanged()),
    waiting: () => asksOf(state.value),
    current: () => state.value[0]?.ask,
    enqueue(ask) {
      if (ask.signal?.aborted) return Promise.resolve(refusalOf(ask));
      return new Promise((resolve) => {
        const waiting: Waiting<K> = { ask, settle: resolve };
        state.next([...state.value, waiting]);
        // A question the kernel withdraws, such as a firewall question left unanswered, leaves the line.
        ask.signal?.addEventListener('abort', () => {
          if (state.value.includes(waiting)) remove(waiting, refusalOf(ask));
        }, { once: true });
      });
    },
    answer(answer) {
      const [head] = state.value;
      if (head) remove(head, answer);
    },
    dismissWindow(windowId) {
      for (const waiting of state.value.filter((entry) => entry.ask.windowId === windowId)) remove(waiting, refusalOf(waiting.ask));
    },
    forWindow: (windowId) => asksOf(state.value).filter((ask) => ask.windowId === windowId),
  };
}

/** One queue for each kind the kernel asks. */
export type AskQueues = { readonly [K in AskKind]: AskQueue<K> };

/**
 * A queue for each ask kind, each empty.
 *
 * @returns The queues, keyed by kind.
 * @example
 * ```ts
 * const queues = createAskQueues();
 * const host = { ...rest, asks: createAskRenderers(queues) };
 * queues['sign.replace'].current$.subscribe(draw);
 * ```
 */
export function createAskQueues(): AskQueues {
  return {
    'sign.replace': createAskQueue(),
    'upload.file': createAskQueue(),
    'download.add': createAskQueue(),
    'connection.direct': createAskQueue(),
    'firewall.approve': createAskQueue(),
    'intent.choose-handler': createAskQueue(),
    'messaging.choose-reply': createAskQueue(),
    'settings.present': createAskQueue(),
  };
}

/** The queues a host draws from, by the kind each holds; several kinds may share one. */
export type AskQueuesByKind = { readonly [K in AskKind]?: Pick<AskQueue<K>, 'enqueue'> };

/**
 * The renderers for `KernlHost.asks`: each kind given a queue is put in it. A kind left out has no
 * renderer, so the kernel refuses it.
 *
 * @param queues - The queue for each kind the host draws.
 * @returns The renderers.
 * @example
 * ```ts
 * const kernl = createKernl({ host: { ...host, asks: createAskRenderers(createAskQueues()) } });
 * ```
 */
export function createAskRenderers(queues: AskQueuesByKind): AskRenderers {
  const renderers: Partial<Record<AskKind, AskRenderer<AskKind>>> = {};
  for (const kind of ASK_KINDS) {
    const queue = queues[kind] as Pick<AskQueue<AskKind>, 'enqueue'> | undefined;
    if (queue) renderers[kind] = (ask) => queue.enqueue(ask);
  }
  return renderers as AskRenderers;
}
