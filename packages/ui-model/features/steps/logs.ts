import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { GuardEvent } from '@kernlize/guard';
import type { MessagingBackend } from '@kernlize/messaging';
import { createGuardLog, createNoticeStore, createTrafficLog, createUnreadCount, type GuardLog, type NoticeStore, type TrafficLog, type UnreadCount } from '@kernlize/ui-model';

type DmMessage = Parameters<Parameters<MessagingBackend['subscribe']>[1]>[0];

interface Row { readonly windowId: string; readonly mark?: 'error' | 'warning'; readonly n: number; readonly kind?: string; readonly repeats?: number }

interface LogsWorld {
  guard?: GuardLog;
  traffic?: TrafficLog<Row>;
  changes: number;
  notices?: NoticeStore;
  timers: Array<{ at: number; run: () => void }>;
  now: number;
  unread?: UnreadCount;
  stop?: () => void;
  deliver?: (message: DmMessage) => void;
  unsubscribed: string[];
  release?: () => void;
}

const world_ = (world: Partial<LogsWorld>): LogsWorld => {
  world.changes ??= 0;
  world.timers ??= [];
  world.now ??= 0;
  world.unsubscribed ??= [];
  return world as LogsWorld;
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const event = (disposition: string, windowId: string): GuardEvent => ({ disposition, windowId } as never);

Given('a guard log that keeps {int} events', (world: LogsWorld, keep: number) => {
  world_(world).guard = createGuardLog(keep);
});

When('the guard reports {string} for window {string}, {string} for window {string} and {string} for window {string}', (world: LogsWorld, a: string, wa: string, b: string, wb: string, c: string, wc: string) => {
  for (const [disposition, windowId] of [[a, wa], [b, wb], [c, wc]] as const) world.guard?.push(event(disposition, windowId));
});

Then('the guard log holds {int} events and counts {int}', (world: LogsWorld, held: number, total: number) => {
  expect(world.guard?.events().length).toBe(held);
  expect(world.guard?.total()).toBe(total);
});

Then('window {string} is in quarantine, and window {string} is not', (world: LogsWorld, inside: string, outside: string) => {
  expect(world.guard?.quarantined().has(inside)).toBe(true);
  expect(world.guard?.quarantined().has(outside)).toBe(false);
});

Then('the guard log holds {int} events for window {string}', (world: LogsWorld, count: number, windowId: string) => {
  expect(world.guard?.forWindow(windowId).length).toBe(count);
});

When('the guard releases window {string} and window {string}', (world: LogsWorld, first: string, second: string) => {
  world.guard?.released(first);
  world.guard?.released(second);
});

Then('no window is in quarantine', (world: LogsWorld) => {
  expect(world.guard?.quarantined().size).toBe(0);
});

Given('a traffic log that keeps {int} rows per window', (world: LogsWorld, keep: number) => {
  const state = world_(world);
  state.traffic = createTrafficLog<Row>(keep);
  state.traffic.changes$.subscribe(() => (state.changes += 1));
});

Given('a traffic log that folds repeated rows and keeps {int} rows per window', (world: LogsWorld, keep: number) => {
  const state = world_(world);
  state.traffic = createTrafficLog<Row>(keep, (kept, arriving) => (kept.kind === arriving.kind ? { ...arriving, repeats: (kept.repeats ?? 1) + 1 } : undefined));
  state.traffic.changes$.subscribe(() => (state.changes += 1));
});

When('window {string} logs a row of {string} and then {int} rows of {string}', (world: LogsWorld, windowId: string, first: string, count: number, then: string) => {
  world.traffic?.add({ windowId, n: 0, kind: first });
  for (let n = 1; n <= count; n += 1) world.traffic?.add({ windowId, n, kind: then });
});

Then('the newest row for window {string} stands for {int} rows', (world: LogsWorld, windowId: string, count: number) => {
  expect(world.traffic?.forWindow(windowId)[0].repeats).toBe(count);
});

Then('window {string} counts {int} rows', (world: LogsWorld, windowId: string, count: number) => {
  expect(world.traffic?.total(windowId)).toBe(count);
});

When('window {string} logs rows marked {string} and window {string} logs a row marked {string}', (world: LogsWorld, first: string, marks: string, second: string, mark: string) => {
  const row = (windowId: string, value: string, n: number): Row => (value === 'none' ? { windowId, n } : { windowId, n, mark: value as Row['mark'] & string });
  marks.split(',').forEach((value, n) => world.traffic?.add(row(first, value, n)));
  world.traffic?.add(row(second, mark, 0));
});

Then('window {string} shows {int} rows, newest first, with {int} error(s) and {int} warning(s) counted', (world: LogsWorld, windowId: string, rows: number, errors: number, warnings: number) => {
  const shown = world.traffic?.forWindow(windowId) ?? [];
  expect(shown.length).toBe(rows);
  expect(shown.map((entry) => entry.n)).toEqual(shown.map((entry) => entry.n).sort((a, b) => b - a));
  expect(world.traffic?.marks(windowId)).toEqual({ errors, warnings });
});

When('the traffic log keeps only window {string}', (world: LogsWorld, windowId: string) => {
  world.traffic?.retain(new Set([windowId]));
});

Then('the traffic log changed {int} times', (world: LogsWorld, times: number) => {
  // One for the stream's start, one per row, one per window forgotten; keeping what is already kept changes nothing.
  expect(world.changes).toBe(times + 1);
});

Given('a notice store with a clock the scenario moves', (world: LogsWorld) => {
  const state = world_(world);
  state.notices = createNoticeStore((run, delayMs) => void state.timers.push({ at: state.now + delayMs, run }));
});

When('the shell notifies {string} as {string} and {string} as {string}', (world: LogsWorld, first: string, firstTone: string, second: string, secondTone: string) => {
  world.notices?.push({ title: first, tone: firstTone as 'info' });
  world.notices?.push({ title: second, tone: secondTone as 'warning' });
});

When('{int} ms go by on the notice clock', (world: LogsWorld, ms: number) => {
  world.now += ms;
  for (const timer of world.timers.filter((entry) => entry.at <= world.now)) timer.run();
});

When('the person dismisses {string}', (world: LogsWorld, title: string) => {
  const notice = world.notices?.items().find((item) => item.title === title);
  if (notice) world.notices?.dismiss(notice.id);
});

Then('the notices on screen are {string}', (world: LogsWorld, titles: string) => {
  expect(world.notices?.items().map((item) => item.title).join(',')).toBe(titles);
});

Given('an unread count over a backend owned by {string}', (world: LogsWorld, owner: string) => {
  const state = world_(world);
  state.unread = createUnreadCount();
  let answer: (() => void) | undefined;
  const answered = new Promise<void>((resolve) => (answer = resolve));
  state.release = answer;
  let reading = false;
  Object.assign(state, { setReading: (value: boolean) => (reading = value) });
  state.stop = state.unread.watch({
    status: async () => ({ available: true, ownerPubkey: owner, implementations: [], capabilities: [] }),
    subscribe: async (_request, onMessage) => {
      await answered;
      state.deliver = onMessage;
      return { subscriptionId: 'sub-1' };
    },
    unsubscribe: async (id) => {
      state.unsubscribed.push(id);
      return { ok: true };
    },
  }, () => reading);
});

When('{string} writes while the person is elsewhere, {string} writes, and {string} writes while the person reads', async (world: LogsWorld, first: string, owner: string, second: string) => {
  world.release?.();
  await settle();
  const setReading = Reflect.get(world, 'setReading') as (value: boolean) => void;
  world.deliver?.({ senderPubkey: first } as DmMessage);
  world.deliver?.({ senderPubkey: owner } as DmMessage);
  setReading(true);
  world.deliver?.({ senderPubkey: second } as DmMessage);
});

Then('the unread count is {int}', (world: LogsWorld, count: number) => {
  expect(world.unread?.count()).toBe(count);
});

When('the count is cleared', (world: LogsWorld) => {
  world.unread?.clear();
});

When('the watch is stopped', (world: LogsWorld) => {
  world.stop?.();
});

When('the watch is stopped before the backend answers', async (world: LogsWorld) => {
  world.stop?.();
  world.release?.();
  await settle();
});

Then('the backend was unsubscribed', async (world: LogsWorld) => {
  await settle();
  expect(world.unsubscribed).toEqual(['sub-1']);
});

Given('the logs with their defaults', (world: LogsWorld) => {
  const state = world_(world);
  state.guard = createGuardLog();
  state.traffic = createTrafficLog<Row>();
  state.notices = createNoticeStore();
});

When('{int} guard events and {int} rows for window {string} are logged, and a notice is shown', (world: LogsWorld, events: number, rows: number, windowId: string) => {
  for (let n = 0; n < events; n += 1) world.guard?.push(event('pass', windowId));
  for (let n = 0; n < rows; n += 1) world.traffic?.add({ windowId, n });
  world.notices?.push({ title: 'Saved', tone: 'info' });
});

Then('window {string} keeps {int} rows', (world: LogsWorld, windowId: string, rows: number) => {
  expect(world.traffic?.forWindow(windowId).length).toBe(rows);
});

Then('the notice is on screen until its time is up', (world: LogsWorld) => {
  expect(world.notices?.items().map((item) => item.title)).toEqual(['Saved']);
});
