import { BehaviorSubject, Subject } from 'rxjs';
import type { HandlerDefaults, InstallableApplet, InstalledApplet, InstalledApplets, IntentDeliveryOptions, IntentRouter } from '@kernlize/core';
import type { Intents, KernlHost, StorageLike } from './contract';
import { readStored } from './preview-state';

const INSTALLED_KEY = 'kernl:preview:installed:v1';
const DEFAULTS_KEY = 'kernl:preview:intent-defaults:v1';

/** What the preview's intents need from the preview shell. */
export interface PreviewIntentDeps {
  readonly storage: StorageLike;
  readonly host: KernlHost;
  /** A window running this catalogue id, for reuse. */
  readonly findWindow: (catalogId: string) => string | undefined;
  /** Hand a delivery to a preview applet; false while it cannot take one. */
  readonly deliver: (windowId: string, text: string) => boolean;
  readonly retry: { readonly intervalMs: number; readonly attempts: number };
}

/** What the core's delivery hands the preview: an `intent.deliver` envelope. */
type DeliveryMessage = Parameters<IntentDeliveryOptions['send']>[1] & { readonly delivery: { readonly sender: string; readonly action: string; readonly archetype: string } };

/** A request one preview applet makes of another. */
export interface PreviewIntentRequest {
  readonly sender: string;
  readonly archetype: string;
  readonly action: string;
  readonly payload: Readonly<Record<string, string>>;
}

export interface PreviewIntents {
  readonly intents: Intents;
  readonly installed: InstalledApplets;
  /** Route a request through the core's router; resolves to what the asking applet is told. */
  invoke(request: PreviewIntentRequest): Promise<{ readonly ok: boolean; readonly text: string }>;
}

/** The installed set over the host's storage, in the core's shape. */
function createPreviewInstalled(storage: StorageLike): InstalledApplets {
  const list$ = new BehaviorSubject<readonly InstalledApplet[]>(readStored<InstalledApplet[]>(storage, INSTALLED_KEY) ?? []);
  const commit = (next: readonly InstalledApplet[]): void => {
    storage.setItem(INSTALLED_KEY, JSON.stringify(next));
    list$.next(next);
  };
  return {
    list: () => list$.value,
    get: (catalogId) => list$.value.find((applet) => applet.catalogId === catalogId),
    install(summary: InstallableApplet) {
      const applet: InstalledApplet = {
        catalogId: summary.manifest.catalogId,
        address: summary.address,
        title: summary.title,
        publisher: summary.publisher,
        contracts: summary.manifest.archetypes,
        installedAt: Date.now(),
      };
      commit([...list$.value.filter((entry) => entry.catalogId !== applet.catalogId), applet]);
      return applet;
    },
    remove: (catalogId) => commit(list$.value.filter((applet) => applet.catalogId !== catalogId)),
    catalog: () =>
      list$.value
        .filter((applet) => applet.contracts.length > 0)
        .map((applet) => ({
          id: applet.catalogId,
          title: applet.title,
          archetypes: Object.fromEntries(applet.contracts.map((contract) => [contract.slug, { contracts: [{ convention: contract.convention, params: [...contract.params] }] }])),
        })),
    changes$: list$.asObservable(),
  };
}

/** Defaults kept on this device only: the preview has no account to publish them to. */
function createPreviewDefaults(storage: StorageLike): HandlerDefaults {
  const local = readStored<Record<string, string>>(storage, DEFAULTS_KEY) ?? {};
  const changes$ = new Subject<string>();
  return {
    get: (archetype) => local[archetype],
    all: () => ({ ...local }),
    async set(archetype, catalogId) {
      if (catalogId === undefined) delete local[archetype];
      else local[archetype] = catalogId;
      storage.setItem(DEFAULTS_KEY, JSON.stringify(local));
      changes$.next(archetype);
    },
    synced: () => undefined,
    load: async () => undefined,
    sync: false,
    setSync: () => undefined,
    changes$: changes$.asObservable(),
  };
}

/**
 * Intents for the preview: the core's own router and delivery (imported on
 * first use, like the consent describer) over an installed set and defaults
 * kept in the host's storage. Preview applets do not speak the wire protocol,
 * so delivery is a window message the applet logs.
 */
export function createPreviewIntents(deps: PreviewIntentDeps): PreviewIntents {
  const installed = createPreviewInstalled(deps.storage);
  const defaults = createPreviewDefaults(deps.storage);
  const titleOf = (catalogId: string): string => installed.get(catalogId)?.title ?? 'An applet';
  let router: Promise<IntentRouter> | undefined;

  const load = (): Promise<IntentRouter> =>
    (router ??= import('@kernlize/core').then((core) => {
      const deliver = core.createIntentDelivery({
        installed,
        findWindow: deps.findWindow,
        openApplet: async (address) => deps.host.openApplet?.(address),
        ...(deps.host.focusApplet ? { focus: deps.host.focusApplet.bind(deps.host) } : {}),
        send: (windowId, message) => {
          const { delivery } = message as DeliveryMessage;
          return deps.deliver(windowId, `${titleOf(delivery.sender)} asked this applet to ${delivery.action} a ${delivery.archetype}.`);
        },
        retry: deps.retry,
      });
      return core.createIntentRouter({
        installed,
        defaults,
        ...(deps.host.chooseHandler ? { choose: deps.host.chooseHandler.bind(deps.host) } : {}),
        describeSender: titleOf,
        deliver: (params) =>
          deliver(params).catch((error: Error) => {
            const body = error.message === 'unavailable:window' ? 'It could not be opened.' : 'It needs "opening other applets" switched on in its grants.';
            deps.host.notify({ title: `${titleOf(params.handler)} could not take the request`, body, tone: 'warning' });
            throw error;
          }),
      });
    }));

  return {
    installed,
    intents: {
      installed$: installed.changes$,
      installed: () => installed.list(),
      uninstall: (catalogId) => installed.remove(catalogId),
      defaults,
    },
    async invoke(request) {
      const resolver = await load();
      const convention = `napplet:${request.archetype}/${request.action}`;
      const result = await resolver.invoke(
        { archetype: request.archetype, action: request.action, convention, payload: request.payload },
        { sender: request.sender },
      );
      return result.ok ? { ok: true, text: `${titleOf(result.handler)} is taking it.` } : { ok: false, text: `Nobody took it (${result.error}).` };
    },
  };
}
