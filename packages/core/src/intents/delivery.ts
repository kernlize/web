import type { IntentDelivery, IntentDispatchParams } from '@kehto/services';
import type { NappletMessage } from '@napplet/core';
import type { InstalledApplets } from './installed.js';

/**
 * How often, and how many times, delivery is retried while the target's
 * session comes up: 100 ms apart for up to 15 s.
 *
 * @example
 * ```ts
 * createIntentDelivery({ ...deps, retry: DELIVERY_RETRY });
 * ```
 */
export const DELIVERY_RETRY = Object.freeze({ intervalMs: 100, attempts: 150 });

/** What {@link createIntentDelivery} needs from the shell. */
export interface IntentDeliveryOptions {
  readonly installed: InstalledApplets;
  /** A window already running this catalogue id, for reuse. */
  readonly findWindow: (catalogId: string) => string | undefined;
  /** Ask the host to open the applet at this address; resolves to its window id, or undefined when it did not open. */
  readonly openApplet: (address: string) => Promise<string | undefined>;
  readonly focus?: (windowId: string) => void;
  /** The runtime's recipient-checked send; false while the target is not eligible yet. */
  readonly send: (windowId: string, message: NappletMessage) => boolean;
  readonly retry?: { readonly intervalMs: number; readonly attempts: number };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deliver an accepted intent to its target.
 *
 * A running window of the handler is reused unless the request said
 * `reuse: false`, and focused unless it said `focus: false`; otherwise the
 * host opens the applet. The delivery is retried until the target's session
 * is live and holds the `intent` domain, because the runtime delivers only to
 * an eligible recipient (NAP-INTENT: "deliver only after the target is
 * ready"). The source window plays no part after acceptance.
 *
 * @param options - Installed set, window lookup, opener, focus and the runtime send.
 * @returns The target controller's delivery function.
 * @throws `unavailable:handler` when the handler is no longer installed, `unavailable:window` when it did not open, `unavailable:delivery` when it never became eligible.
 * @example
 * ```ts
 * const deliver = createIntentDelivery({ installed, findWindow, openApplet: host.openApplet, send });
 * await deliver(params);
 * ```
 */
export function createIntentDelivery(options: IntentDeliveryOptions): (params: IntentDispatchParams) => Promise<void> {
  const retry = options.retry ?? DELIVERY_RETRY;
  return async (params) => {
    const applet = options.installed.get(params.handler);
    if (!applet) throw new Error('unavailable:handler');
    const running = params.behavior?.reuse === false ? undefined : options.findWindow(params.handler);
    if (running && params.behavior?.focus !== false) options.focus?.(running);
    const windowId = running ?? (await options.openApplet(applet.address));
    if (!windowId) throw new Error('unavailable:window');
    const delivery: IntentDelivery = {
      sender: params.sender,
      archetype: params.archetype,
      action: params.action,
      convention: params.convention,
      ...(params.payload === undefined ? {} : { payload: params.payload }),
    };
    for (let attempt = 0; attempt < retry.attempts; attempt += 1) {
      if (options.send(windowId, { type: 'intent.deliver', delivery } as NappletMessage)) return;
      await pause(retry.intervalMs);
    }
    throw new Error('unavailable:delivery');
  };
}
