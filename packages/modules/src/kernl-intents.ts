import { Subscription, type Observable } from 'rxjs';
import type { ServiceHandler, ServiceRuntimeContext } from '@kehto/runtime';
import { createIntentService } from '@kehto/services';
import type { HandlerChoice, HandlerPrompt, Intents, KernlHost, RelayTiers, ApplesaucePool, MountedApplet } from '@kernlize/kernel';
import { createHandlerDefaults, type PreferenceSigner } from './intents/defaults.js';
import { createIntentDelivery } from './intents/delivery.js';
import { createInstalledApplets, type InstalledApplets } from './intents/installed.js';
import { createIntentRouter } from './intents/router.js';

type IntentWindow = Pick<MountedApplet, 'windowId' | 'summary' | 'domains'>;

/** What {@link createKernlIntents} needs from the composed shell. */
export interface KernlIntentDeps {
  readonly host: Pick<KernlHost, 'storage' | 'now' | 'notify' | 'openApplet' | 'focusApplet'>;
  /** Asks the person which applet takes a request; without it, a request no default settles is refused. */
  readonly choose?: (prompt: HandlerPrompt) => Promise<HandlerChoice | undefined>;
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  /** The signed-in identity: its pubkey, its changes, and a signer for the person's own preferences, none when it cannot sign. */
  readonly identity: { pubkey(): string | undefined; readonly pubkey$: Observable<unknown>; signer(): PreferenceSigner | undefined };
  /** Live applets and their startup domains by window id; the source of every sender identity. */
  readonly handles: ReadonlyMap<string, Pick<MountedApplet, 'windowId' | 'summary' | 'domains'>>;
  readonly retry?: { readonly intervalMs: number; readonly attempts: number };
}

/** The intent service for kehto's registry, the user-facing surface and the installed set the lifecycle writes. */
export interface KernlIntents {
  readonly handler: ServiceHandler;
  readonly intents: Intents;
  readonly installed: InstalledApplets;
  close(): void;
}

const FAILURES: Readonly<Record<string, string>> = {
  'unavailable:delivery': 'It needs "opening other applets" switched on in its grants to receive requests from other applets.',
  'unavailable:convention': 'This release does not take that request.',
  'unavailable:window': 'It could not be opened.',
  'unavailable:handler': 'It is no longer installed.',
};

/** What the user is told when the host itself failed while opening the handler. */
const UNREACHABLE = 'It could not be reached.';

function accepts(handle: IntentWindow, catalogId: string, convention: string): boolean {
  const { manifest } = handle.summary;
  return manifest.catalogId === catalogId && manifest.archetypes.some((entry) => entry.convention === convention);
}

/**
 * Keep the runtime context kehto hands the intent service, so delivery can
 * use the runtime's recipient-checked send rather than a raw port.
 */
function withContext(inner: ServiceHandler, hold: (context: ServiceRuntimeContext | undefined) => void): ServiceHandler {
  return {
    ...inner,
    onRegistered(context) {
      hold(context);
      inner.onRegistered?.(context);
    },
    onUnregistered() {
      hold(undefined);
      inner.onUnregistered?.();
    },
  };
}

/**
 * Compose NAP-INTENT for the shell: the installed set, the user's handler
 * defaults, kernl's router over kehto's catalogue resolver, delivery through
 * the host's window opener, and kehto's `createIntentService`.
 *
 * The sender of every invocation is the verified catalogue id of the window
 * it came from, looked up from the shell's own handles and never from the
 * message. The user's published preferences are re-read whenever the active
 * account changes. A delivery that fails after acceptance is reported to the
 * user, since the source has already been told yes.
 *
 * @param deps - Host, pool, tiers, the signed-in identity and the live applets.
 * @returns The service handler, the facade and the installed set.
 * @example
 * ```ts
 * const intents = createKernlIntents({ host, pool, tiers, identity, handles });
 * services.registry.intent = intents.handler;
 * ```
 */
export function createKernlIntents(deps: KernlIntentDeps): KernlIntents {
  const { host, handles } = deps;
  const installed = createInstalledApplets(host.storage, host.now ? host.now.bind(host) : Date.now);
  const defaults = createHandlerDefaults({
    storage: host.storage,
    pool: deps.pool,
    tiers: deps.tiers,
    pubkey: () => deps.identity.pubkey(),
    signer: () => deps.identity.signer(),
  });
  let context: ServiceRuntimeContext | undefined;
  const titleOf = (catalogId: string): string => installed.get(catalogId)?.title ?? 'An applet';

  const deliver = createIntentDelivery({
    installed,
    findWindow: (catalogId, convention) => [...handles.values()].find((handle) => handle.domains.includes('intent') && accepts(handle, catalogId, convention))?.windowId,
    openApplet: async (address, options) => host.openApplet?.(address, options),
    ...(host.focusApplet ? { focus: host.focusApplet.bind(host) } : {}),
    send(windowId, message, { handler, convention }) {
      const handle = handles.get(windowId);
      if (!handle) return false;
      // The address may have resolved to a different release after the router read the installed contracts.
      if (!accepts(handle, handler, convention)) throw new Error('unavailable:convention');
      // The runtime still checks session, domain and `intent:read` (D-037).
      return handle.domains.includes('intent') && context?.sendToEligibleNapplet(windowId, message) === true;
    },
    ...(deps.retry ? { retry: deps.retry } : {}),
  });

  const router = createIntentRouter({
    installed,
    defaults,
    ...(deps.choose ? { choose: deps.choose } : {}),
    describeSender: titleOf,
    deliver: (params) =>
      deliver(params).catch((error: Error) => {
        const body = error.message === 'unavailable:delivery' && params.behavior?.focus === false
          ? 'Show the applet and try again. Check that it has the grant to receive requests.'
          : FAILURES[error.message] ?? UNREACHABLE;
        host.notify({ title: `${titleOf(params.handler)} could not take the request`, body, tone: 'warning' });
        throw error;
      }),
  });

  const service = createIntentService({ resolver: router, resolveSender: (windowId) => handles.get(windowId)?.summary.manifest.catalogId });
  const subscriptions = new Subscription();
  subscriptions.add(installed.changes$.subscribe((list) => {
    for (const slug of new Set(list.flatMap((applet) => applet.contracts.map((contract) => contract.slug)))) router.notifyChanged(slug);
  }));
  subscriptions.add(defaults.changes$.subscribe((archetype) => router.notifyChanged(archetype)));
  subscriptions.add(deps.identity.pubkey$.subscribe(() => void defaults.load()));

  return {
    handler: withContext(service, (next) => {
      context = next;
    }),
    installed,
    intents: {
      installed$: installed.changes$,
      installed: () => installed.list(),
      uninstall: (catalogId) => installed.remove(catalogId),
      record: (summary) => installed.install(summary),
      defaults,
    },
    close: () => subscriptions.unsubscribe(),
  };
}
