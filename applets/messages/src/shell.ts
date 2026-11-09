import {
  dm,
  identity,
  keys,
  notify,
  storage,
  themeGet,
  themeOnChanged,
  type DmConversationPage,
  type DmMessage,
  type DmMessagePage,
  type DmMessageQuery,
  type DmSendRequest,
  type DmSendResult,
  type DmStatus,
  type Subscription,
  type Theme,
} from '@napplet/sdk';
import { unwrapDmResult } from './dm-result.js';
import { createPacer, type Lane } from './pacer.js';
import { wasDropped, withRetry, type RetryPolicy } from './retry.js';

/**
 * Every request this applet makes of the shell leaves through this module.
 *
 * The shell's guard allows an applet about eight requests a second, a quarter
 * of that while its window is unfocused, and silently drops the excess: the
 * caller only finds out when the binding gives up half a minute later. So all
 * requests share one pacer set to half the focused budget, a send goes ahead
 * of queued reads, and reads that may have been dropped are asked again.
 * Sends never are: the shell may be putting a question to the person. Any
 * sign of a drop or refusal slows the pacer to one request a second for a
 * while, which fits inside the unfocused budget and lets it recover.
 *
 * The listeners at the bottom are not paced because they send nothing; the
 * binding only records the handler.
 */
const pacer = createPacer({
  limit: 4,
  windowMs: 1000,
  backgroundLimit: 1,
  slowLimit: 1,
  now: () => performance.now(),
  wake: (delayMs, pump) => window.setTimeout(pump, delayMs),
});

const READ_POLICY: RetryPolicy = { timeoutMs: 4000, retries: 2, backoffMs: 500 };
const SLOW_DOWN_MS = 5000;

const slowDown = (): void => pacer.slowDown(SLOW_DOWN_MS);

function read<T>(call: () => Promise<T>, lane: Lane = 'normal', discard?: (value: T) => void): Promise<T> {
  const attempt = (started: () => void): Promise<T> =>
    pacer.schedule(lane, () => {
      started();
      return call();
    });
  const options = { policy: READ_POLICY, dropped: slowDown };
  return withRetry(attempt, discard ? { ...options, discard } : options);
}

/** A request that is made once; a refusal still tells the pacer to ease off. */
async function once<T>(lane: Lane, call: () => T | Promise<T>): Promise<T> {
  try {
    return await pacer.schedule(lane, call);
  } catch (error) {
    if (wasDropped(error)) slowDown();
    throw error;
  }
}

/** Every `dm` answer passes through here, so an error record becomes a rejection. */
async function answered<T>(pending: Promise<T>): Promise<T> {
  return unwrapDmResult(await pending);
}

function ignore(): void {
  // Deliberately empty: the call is best effort and has a visible fallback.
}

export function readStatus(): Promise<DmStatus> {
  return read(() => answered(dm.status()));
}

export function readConversations(limit: number): Promise<DmConversationPage> {
  return read(() => answered(dm.conversations({ limit })));
}

export function readMessages(query: DmMessageQuery, lane: Lane): Promise<DmMessagePage> {
  return read(() => answered(dm.messages(query)), lane);
}

/** One attempt, ahead of everything queued, with no clock on it. */
export function send(request: DmSendRequest): Promise<DmSendResult> {
  return once('urgent', () => answered(dm.send(request)));
}

export function stopLiveDelivery(subscriptionId: string): void {
  once('normal', () => answered(dm.unsubscribe(subscriptionId))).catch(ignore);
}

/**
 * Asking twice is safe as long as only one subscription is kept: an answer
 * that arrives after another attempt won is closed again.
 */
export async function startLiveDelivery(): Promise<string> {
  const subscription = await read(
    () => answered(dm.subscribe({})),
    'normal',
    (late) => stopLiveDelivery(late.subscriptionId),
  );
  return subscription.subscriptionId;
}

export function readAccount(): Promise<string> {
  return read(() => identity.getPublicKey());
}

export function readStored(key: string): Promise<string | null> {
  return read(() => storage.getItem(key));
}

export function writeStored(key: string, value: string, lane: Lane): void {
  once(lane, () => storage.setItem(key, value)).catch(ignore);
}

export function readTheme(): Promise<Theme> {
  return read(() => themeGet());
}

let waitingNotice: { title: string; body: string } | null = null;

/**
 * At most one notice waits for its turn. A run of arrivals replaces it with
 * the newest instead of queueing one request per message.
 */
export function sendNotice(title: string, body: string): void {
  const queued = waitingNotice !== null;
  waitingNotice = { title, body };
  if (queued) return;
  const deliver = async (): Promise<void> => {
    const notice = waitingNotice;
    waitingNotice = null;
    if (notice) await notify.send(notice);
  };
  once('normal', deliver).catch(ignore);
}

export interface ShortcutAction {
  id: string;
  label: string;
  defaultKey: string;
}

/** Offer one action to the shell's keymap; resolves with how to withdraw it. */
export async function registerShortcut(action: ShortcutAction, run: () => void): Promise<() => void> {
  const binding = await once('normal', () => keys.register(action, run));
  return () => {
    once('normal', () => binding.close()).catch(ignore);
  };
}

export function onMessage(handler: (message: DmMessage) => void): Subscription {
  return dm.onMessage((message) => handler(message));
}

export function onAccountChanged(handler: () => void): Subscription {
  return identity.onChanged(() => handler());
}

export function onThemeChanged(handler: (theme: Theme) => void): Subscription {
  return themeOnChanged(handler);
}
