import { BehaviorSubject, type Observable } from 'rxjs';
import { manifestToIntentCatalogEntry, type IntentCatalogEntry } from '@kehto/services';
import type { AppletSummary, StorageLike } from '../types.js';
import { createNamespacedStore } from '../persistence/store.js';

/** One advertised convention, as the verified manifest's `z` and `i` tags declared it. */
export interface InstalledContract {
  readonly slug: string;
  readonly convention: string;
  readonly params: readonly string[];
}

/** An applet the user has run, remembered so other applets can hand work to it. */
export interface InstalledApplet {
  readonly catalogId: string;
  /** What the shell resolves to open it again. */
  readonly address: string;
  readonly title: string;
  readonly publisher: string;
  readonly contracts: readonly InstalledContract[];
  readonly installedAt: number;
}

/** What installing reads from a verified applet's summary. */
export type InstallableApplet = Pick<AppletSummary, 'address' | 'title' | 'publisher'> & {
  readonly manifest: Pick<AppletSummary['manifest'], 'catalogId' | 'archetypes'>;
};

/** The installed set: what NAP-INTENT's `available()` and `handlers()` are built from. */
export interface InstalledApplets {
  list(): readonly InstalledApplet[];
  get(catalogId: string): InstalledApplet | undefined;
  /** Remember a verified applet. Re-installing replaces its contracts and keeps its place. */
  install(summary: InstallableApplet): InstalledApplet;
  remove(catalogId: string): void;
  /** The installed set as kehto's catalogue resolver reads it. */
  catalog(): readonly IntentCatalogEntry[];
  /** Replays the current list to new subscribers. */
  readonly changes$: Observable<readonly InstalledApplet[]>;
}

const STORAGE_KEY = 'installed:v1';

function isInstalled(value: unknown): value is InstalledApplet {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.catalogId === 'string' && typeof row.address === 'string' && typeof row.title === 'string' && typeof row.publisher === 'string' && Array.isArray(row.contracts) && typeof row.installedAt === 'number';
}

/** A contract kehto's adapter refuses is dropped, never fatal: an odd `i` tag must not hide the applet. */
function toCatalogEntry(applet: InstalledApplet): IntentCatalogEntry | undefined {
  const archetypes = applet.contracts.filter((contract) => {
    try {
      manifestToIntentCatalogEntry({ catalogId: applet.catalogId, archetypes: [{ ...contract, params: [...contract.params] }] });
      return true;
    } catch {
      return false;
    }
  });
  if (archetypes.length === 0) return undefined;
  return manifestToIntentCatalogEntry({ catalogId: applet.catalogId, title: applet.title, archetypes: archetypes.map((contract) => ({ ...contract, params: [...contract.params] })) });
}

/**
 * The applets the user has run, persisted at `kernl:installed:v1`.
 *
 * Installing happens when the shell plans a verified applet, so the routing
 * contracts always come from a verified manifest (NAP-INTENT, "Runtime
 * Behavior"). Advertisements are routing hints; they grant nothing.
 *
 * @param storage - Where the list is kept.
 * @param now - Clock for `installedAt`.
 * @returns The installed set.
 * @example
 * ```ts
 * const installed = createInstalledApplets(localStorage);
 * installed.install(summary);
 * installed.catalog(); // [{ id: 'nip5d:35129:…:notepad', archetypes: { 'text-editor': … } }]
 * ```
 */
export function createInstalledApplets(storage: StorageLike, now: () => number = Date.now): InstalledApplets {
  const store = createNamespacedStore(storage, 'kernl');
  const stored = store.getJson<unknown>(STORAGE_KEY, []);
  const changes$ = new BehaviorSubject<readonly InstalledApplet[]>(Object.freeze(Array.isArray(stored) ? stored.filter(isInstalled) : []));

  const commit = (next: readonly InstalledApplet[]): void => {
    store.setJson(STORAGE_KEY, next);
    changes$.next(Object.freeze([...next]));
  };

  return {
    list: () => changes$.value,
    get: (catalogId) => changes$.value.find((applet) => applet.catalogId === catalogId),
    install(summary) {
      const { manifest } = summary;
      const previous = changes$.value.find((applet) => applet.catalogId === manifest.catalogId);
      const applet: InstalledApplet = Object.freeze({
        catalogId: manifest.catalogId,
        address: summary.address,
        title: summary.title,
        publisher: summary.publisher,
        contracts: Object.freeze(manifest.archetypes.map((entry) => Object.freeze({ slug: entry.slug, convention: entry.convention, params: Object.freeze([...entry.params]) }))),
        installedAt: previous?.installedAt ?? now(),
      });
      commit(previous ? changes$.value.map((entry) => (entry === previous ? applet : entry)) : [...changes$.value, applet]);
      return applet;
    },
    remove(catalogId) {
      if (changes$.value.some((applet) => applet.catalogId === catalogId)) commit(changes$.value.filter((applet) => applet.catalogId !== catalogId));
    },
    catalog: () => changes$.value.map(toCatalogEntry).filter((entry): entry is IntentCatalogEntry => entry !== undefined),
    changes$: changes$.asObservable(),
  };
}
