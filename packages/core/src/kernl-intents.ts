import { Subscription } from 'rxjs';
import type { AccountManager, IAccount } from 'applesauce-accounts';
import type { ServiceHandler, ServiceRuntimeContext } from '@kehto/runtime';
import { originRegistry } from '@kehto/shell';
import { createIntentService } from '@kehto/services';
import type { EventTemplate, NostrEvent } from '@napplet/core';
import type { Intents, KernlHost, RelayTiers } from './types.js';
import type { ApplesaucePool } from './applesauce/relay-hooks.js';
import { isReadOnlyAccount } from './applesauce/auth-hooks.js';
import type { MountedApplet } from './applets/mount.js';
import { createHandlerDefaults, type PreferenceSigner } from './intents/defaults.js';
import { createIntentDelivery } from './intents/delivery.js';
import { createInstalledApplets, type InstalledApplets } from './intents/installed.js';
import { createIntentRouter } from './intents/router.js';

/** What {@link createKernlIntents} needs from the composed shell. */
export interface KernlIntentDeps {
  readonly host: KernlHost;
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  readonly accounts: AccountManager;
  /** Live applet handles by window id; the source of every sender identity. */
  readonly handles: ReadonlyMap<string, MountedApplet>;
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
  'unavailable:window': 'It could not be opened.',
  'unavailable:handler': 'It is no longer installed.',
};

/** What the user is told when the host itself failed while opening the handler. */
const UNREACHABLE = 'It could not be reached.';

function signerOf(account: IAccount | undefined): PreferenceSigner | undefined {
  if (!account || isReadOnlyAccount(account)) return undefined;
  return (template: EventTemplate) => account.signEvent(template) as Promise<NostrEvent>;
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
 * @param deps - Host, pool, tiers, accounts and live handles.
 * @returns The service handler, the facade and the installed set.
 * @example
 * ```ts
 * const intents = createKernlIntents({ host, pool, tiers, accounts, handles });
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
    pubkey: () => deps.accounts.active?.pubkey,
    signer: () => signerOf(deps.accounts.active),
  });
  let context: ServiceRuntimeContext | undefined;
  const titleOf = (catalogId: string): string => installed.get(catalogId)?.title ?? 'An applet';

  const deliver = createIntentDelivery({
    installed,
    findWindow: (catalogId) => [...handles.values()].find((handle) => handle.summary.manifest.catalogId === catalogId)?.windowId,
    openApplet: async (address) => host.openApplet?.(address),
    ...(host.focusApplet ? { focus: host.focusApplet.bind(host) } : {}),
    // kehto's ACL gives `intent.deliver` no recipient capability, so the runtime's recipient-checked
    // send refuses it. Like kehto's own Paja host, the delivery goes over the target's bound port,
    // and only to a live session that holds the receiving grant (DECISIONS.md D-026).
    send: (windowId, message) => context?.hasCapability(windowId, 'intent:read') === true && originRegistry.postToNapplet(windowId, message),
    ...(deps.retry ? { retry: deps.retry } : {}),
  });

  const router = createIntentRouter({
    installed,
    defaults,
    ...(host.chooseHandler ? { choose: host.chooseHandler.bind(host) } : {}),
    describeSender: titleOf,
    deliver: (params) =>
      deliver(params).catch((error: Error) => {
        host.notify({ title: `${titleOf(params.handler)} could not take the request`, body: FAILURES[error.message] ?? UNREACHABLE, tone: 'warning' });
        throw error;
      }),
  });

  const service = createIntentService({ resolver: router, resolveSender: (windowId) => handles.get(windowId)?.summary.manifest.catalogId });
  const subscriptions = new Subscription();
  subscriptions.add(installed.changes$.subscribe((list) => {
    for (const slug of new Set(list.flatMap((applet) => applet.contracts.map((contract) => contract.slug)))) router.notifyChanged(slug);
  }));
  subscriptions.add(defaults.changes$.subscribe((archetype) => router.notifyChanged(archetype)));
  subscriptions.add(deps.accounts.active$.subscribe(() => void defaults.load()));

  return {
    handler: withContext(service, (next) => {
      context = next;
    }),
    installed,
    intents: {
      installed$: installed.changes$,
      installed: () => installed.list(),
      uninstall: (catalogId) => installed.remove(catalogId),
      defaults,
    },
    close: () => subscriptions.unsubscribe(),
  };
}
