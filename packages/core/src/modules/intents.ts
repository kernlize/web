import { createKernlIntents } from '../kernl-intents.js';
import type { NostrEvent } from '@napplet/core';
import type { HandlerPrompt, Intents } from '../types.js';
import type { KernlModule } from './module.js';

/** kernl's own heading for the handler question. */
const CHOOSER_TEXT = Object.freeze({ title: 'Choose an applet' });

/**
 * Applets handing work to each other, the `intent` domain (NAP-INTENT): the installed set, the
 * person's handler preferences, and delivery to the handler's window, opened through the host's
 * `openApplet` and asked about as an `intent.choose-handler` ask. Without it `intent` is not offered and
 * nothing is installed.
 *
 * @param options - How delivery waits for a target to come up; `DELIVERY_RETRY` by default.
 * @returns The module; its api is `Intents`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [intentsModule()] });
 * kernl.intents.installed();
 * ```
 */
export function intentsModule(options: { readonly retry?: { readonly intervalMs: number; readonly attempts: number } } = {}): KernlModule<'intents', Intents> {
  return {
    id: 'intents',
    asks: ['intent.choose-handler'],
    setup(context) {
      const intents = createKernlIntents({
        host: context.host,
        // With nothing to draw the question, kehto refuses a request no default settles, as it always did (D-067).
        ...(context.canAsk('intent.choose-handler') ? { choose: (prompt: HandlerPrompt) => context.ask({ kind: 'intent.choose-handler', facts: prompt, defaultText: CHOOSER_TEXT }) } : {}),
        pool: context.pool,
        tiers: context.tiers,
        identity: {
          pubkey: () => context.identity.pubkey(),
          pubkey$: context.identity.pubkey$,
          signer() {
            const signer = context.signer();
            return signer && ((template) => signer.signEvent(template) as Promise<NostrEvent>);
          },
        },
        handles: context.applets(),
        ...(options.retry ? { retry: options.retry } : {}),
      });
      return { services: { intent: intents.handler }, api: intents.intents, dispose: () => intents.close() };
    },
  };
}
