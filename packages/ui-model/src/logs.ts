import { BehaviorSubject, type Observable } from 'rxjs';
import type { GuardEvent } from '@kernlize/guard';
import type { MessagingBackend } from '@kernlize/messaging';

/** The guard's events this page, newest first, which windows it holds in quarantine, and how many it has seen. */
export interface GuardLog {
  readonly events$: Observable<readonly GuardEvent[]>;
  readonly quarantined$: Observable<ReadonlySet<string>>;
  readonly total$: Observable<number>;
  events(): readonly GuardEvent[];
  quarantined(): ReadonlySet<string>;
  total(): number;
  push(event: GuardEvent): void;
  /** A window the guard let go of: it is no longer in quarantine. */
  released(windowId: string): void;
  forWindow(windowId: string): readonly GuardEvent[];
}

/**
 * The guard log: the newest events, a window's quarantine, and a count that keeps going after the
 * oldest events are dropped. Kept in memory only.
 *
 * @param keep - How many events to keep; 50 by default.
 * @returns An empty log.
 * @example
 * ```ts
 * const log = createGuardLog();
 * kernl.guard.events$.subscribe((event) => log.push(event));
 * log.quarantined$.subscribe((windows) => draw(windows));
 * ```
 */
export function createGuardLog(keep = 50): GuardLog {
  const events = new BehaviorSubject<readonly GuardEvent[]>([]);
  const quarantined = new BehaviorSubject<ReadonlySet<string>>(new Set());
  const total = new BehaviorSubject(0);
  return {
    events$: events.asObservable(),
    quarantined$: quarantined.asObservable(),
    total$: total.asObservable(),
    events: () => events.value,
    quarantined: () => quarantined.value,
    total: () => total.value,
    push(event) {
      events.next([event, ...events.value].slice(0, keep));
      total.next(total.value + 1);
      if (event.disposition === 'quarantine' && !quarantined.value.has(event.windowId)) quarantined.next(new Set([...quarantined.value, event.windowId]));
    },
    released(windowId) {
      if (!quarantined.value.has(windowId)) return;
      quarantined.next(new Set([...quarantined.value].filter((id) => id !== windowId)));
    },
    forWindow: (windowId) => events.value.filter((event) => event.windowId === windowId),
  };
}

/** One row of the traffic log. The model reads only its window and its mark; the rest is the host's. */
export interface TrafficRow {
  readonly windowId: string;
  readonly mark?: 'error' | 'warning';
}

/** How many rows of a window's traffic were marked. */
export interface TrafficMarks {
  readonly errors: number;
  readonly warnings: number;
}

/**
 * Decides whether an arriving row repeats the newest one: the row to keep in its place, or `undefined`
 * to keep both. The host owns what counts as a repeat, because only it knows which of its fields
 * mean the same thing said twice.
 */
export type TrafficFold<R extends TrafficRow> = (kept: R, arriving: R) => R | undefined;

/** What each applet sent and received this page, per window, newest first, with its marks counted. */
export interface TrafficLog<R extends TrafficRow> {
  /** Emits whenever a row is added or windows are forgotten. */
  readonly changes$: Observable<void>;
  add(row: R): void;
  forWindow(windowId: string): readonly R[];
  /** How many rows a window has had, folded ones included, which keeps counting after rows go. */
  total(windowId: string): number;
  marks(windowId: string): TrafficMarks;
  /** Forget every window not in `ids`: a closed window's log goes with it. */
  retain(ids: ReadonlySet<string>): void;
}

const NO_MARKS: TrafficMarks = Object.freeze({ errors: 0, warnings: 0 });

/**
 * The traffic log. Payloads can hold private messages and signed events, so it is never written to
 * storage. A window keeps its newest rows; its marks and its count keep going after older rows go.
 * A `fold` keeps a burst of the same thing from taking the room a failure needs: the repeat replaces
 * the newest row instead of pushing everything down, and no row is lost to it.
 *
 * @param keep - Rows kept per window; 200 by default.
 * @param fold - Whether an arriving row repeats the newest one, and what to keep in its place.
 * @returns An empty log.
 * @example
 * ```ts
 * const traffic = createTrafficLog<{ windowId: string; mark?: 'error' | 'warning'; text: string }>();
 * kernl.traffic$.subscribe((message) => traffic.add({ windowId: message.windowId, text: message.type }));
 * ```
 */
export function createTrafficLog<R extends TrafficRow>(keep = 200, fold?: TrafficFold<R>): TrafficLog<R> {
  let rows: ReadonlyMap<string, readonly R[]> = new Map();
  let marks: ReadonlyMap<string, TrafficMarks> = new Map();
  let totals: ReadonlyMap<string, number> = new Map();
  const changes = new BehaviorSubject<void>(undefined);
  const counted = (current: TrafficMarks, mark: TrafficRow['mark']): TrafficMarks => (mark === 'error' ? { ...current, errors: current.errors + 1 } : { ...current, warnings: current.warnings + 1 });
  return {
    changes$: changes.asObservable(),
    add(row) {
      const held = rows.get(row.windowId) ?? [];
      const [newest] = held;
      const folded = newest && fold ? fold(newest, row) : undefined;
      rows = new Map(rows).set(row.windowId, folded ? [folded, ...held.slice(1)] : [row, ...held].slice(0, keep));
      totals = new Map(totals).set(row.windowId, (totals.get(row.windowId) ?? 0) + 1);
      if (row.mark) marks = new Map(marks).set(row.windowId, counted(marks.get(row.windowId) ?? NO_MARKS, row.mark));
      changes.next();
    },
    forWindow: (windowId) => rows.get(windowId) ?? [],
    total: (windowId) => totals.get(windowId) ?? 0,
    marks: (windowId) => marks.get(windowId) ?? NO_MARKS,
    retain(ids) {
      if ([...rows.keys(), ...marks.keys(), ...totals.keys()].every((id) => ids.has(id))) return;
      rows = new Map([...rows].filter(([id]) => ids.has(id)));
      marks = new Map([...marks].filter(([id]) => ids.has(id)));
      totals = new Map([...totals].filter(([id]) => ids.has(id)));
      changes.next();
    },
  };
}

/** A line the shell shows for a while, then lets go. */
export interface Notice {
  readonly id: number;
  readonly title: string;
  readonly body?: string;
  readonly tone: 'info' | 'warning';
  readonly windowId?: string;
}

/** The notices on screen, oldest first. */
export interface NoticeStore {
  readonly items$: Observable<readonly Notice[]>;
  items(): readonly Notice[];
  push(notice: Omit<Notice, 'id'>): Notice;
  dismiss(id: number): void;
}

/**
 * How long each tone stays on screen, in milliseconds.
 *
 * @example
 * ```ts
 * NOTICE_LIFETIME_MS.warning; // 12000
 * ```
 */
export const NOTICE_LIFETIME_MS: Readonly<Record<Notice['tone'], number>> = Object.freeze({ info: 6000, warning: 12_000 });

/**
 * The notices: each goes by itself after its tone's lifetime, or when dismissed.
 *
 * @param schedule - Runs a callback after a delay; `setTimeout` by default.
 * @returns An empty store.
 * @example
 * ```ts
 * const notices = createNoticeStore();
 * const host = { ...rest, notify: (notice) => void notices.push(notice) };
 * ```
 */
export function createNoticeStore(schedule: (callback: () => void, delayMs: number) => void = (callback, delayMs) => void setTimeout(callback, delayMs)): NoticeStore {
  const items = new BehaviorSubject<readonly Notice[]>([]);
  let next = 1;
  const store: NoticeStore = {
    items$: items.asObservable(),
    items: () => items.value,
    push(notice) {
      const entry: Notice = { ...notice, id: next++ };
      items.next([...items.value, entry]);
      schedule(() => store.dismiss(entry.id), NOTICE_LIFETIME_MS[notice.tone]);
      return entry;
    },
    dismiss(id) {
      items.next(items.value.filter((item) => item.id !== id));
    },
  };
  return store;
}

/** Messages that arrived while the person was not looking. */
export interface UnreadCount {
  readonly count$: Observable<number>;
  count(): number;
  /** Count what arrives from other people while `reading()` is false, until the returned function is called. */
  watch(backend: Pick<MessagingBackend, 'status' | 'subscribe' | 'unsubscribe'>, reading: () => boolean): () => void;
  clear(): void;
}

/**
 * The shell's own unread count. A provider's unread number never goes down, because nothing tells
 * a provider what was read, so the shell counts what arrives while the person is elsewhere.
 *
 * @returns A count at zero.
 * @example
 * ```ts
 * const unread = createUnreadCount();
 * const stop = unread.watch(kernl.messaging.composite(), () => messagesOpen);
 * ```
 */
export function createUnreadCount(): UnreadCount {
  const count = new BehaviorSubject(0);
  return {
    count$: count.asObservable(),
    count: () => count.value,
    watch(backend, reading) {
      let stopped = false;
      let subscriptionId: string | undefined;
      void (async () => {
        const owner = (await backend.status()).ownerPubkey;
        const subscription = await backend.subscribe({}, (message) => {
          if (message.senderPubkey !== owner && !reading()) count.next(count.value + 1);
        });
        if (stopped) void backend.unsubscribe(subscription.subscriptionId);
        else subscriptionId = subscription.subscriptionId;
      })();
      return () => {
        stopped = true;
        if (subscriptionId !== undefined) void backend.unsubscribe(subscriptionId);
      };
    },
    clear: () => count.next(0),
  };
}
