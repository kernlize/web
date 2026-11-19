import { BehaviorSubject, type Observable } from 'rxjs';
import type { CvmRegistryFamily } from '@kehto/services';
import { createNamespacedStore } from '../persistence/store.js';
import type { DirectIceServer, StorageLike } from '../types.js';

const STORAGE_KEY = 'multiplayer:v1';
const HEX_KEY = /^[0-9a-f]{64}$/u;
const HELPER_URL = /^(stuns?|turns?):\S+$/u;
const RELAY_URL = /^wss?:\/\/\S+$/u;

/** What the person chose for meeting people and calling remote tools on this device. */
export interface MultiplayerState {
  /** Servers that introduce people and find tool servers; undefined leaves the host's choice. */
  readonly servers?: readonly string[];
  /** Servers that help connections through; undefined leaves the host's choice. */
  readonly helpers?: readonly DirectIceServer[];
  /** Tool families the person trusts, pinned to verified schemas. */
  readonly families: readonly CvmRegistryFamily[];
}

/** The person's settings for direct connections and remote tools. */
export interface MultiplayerSettings {
  readonly state$: Observable<MultiplayerState>;
  state(): MultiplayerState;
  /** Choose the servers, or `undefined` to go back to the host's. Throws `invalid:relay-url`. */
  setServers(urls: readonly string[] | undefined): void;
  /** Choose the helpers, or `undefined` to go back to the host's. Throws `invalid:helper`. */
  setHelpers(helpers: readonly DirectIceServer[] | undefined): void;
  /** Trust a family, replacing one with the same label and provider. Throws `invalid:family`. */
  saveFamily(family: CvmRegistryFamily): void;
  removeFamily(label: string, pubkey: string): void;
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;

function validServers(urls: readonly unknown[]): urls is readonly string[] {
  return urls.length <= 16 && urls.every((url) => typeof url === 'string' && RELAY_URL.test(url));
}

function validHelper(helper: DirectIceServer): boolean {
  return Array.isArray(helper.urls) && helper.urls.length > 0 && helper.urls.length <= 8
    && helper.urls.every((url) => typeof url === 'string' && HELPER_URL.test(url))
    && (helper.username === undefined || typeof helper.username === 'string')
    && (helper.credential === undefined || typeof helper.credential === 'string');
}

/**
 * Whether a tool family is one the shell can keep: a label, a provider key and
 * relays, and 1 to 64 uniquely named tools each pinned to a schema hash.
 *
 * @param family - A candidate family.
 * @returns True when it can be saved.
 * @example
 * ```ts
 * validFamily({ family: 'rooms', server: { pubkey, relays: ['wss://tools.example'] }, tools: [{ name: 'join', schemaHash }] }); // true
 * ```
 */
export function validFamily(family: CvmRegistryFamily): boolean {
  const { server, tools } = family;
  return text(family.family) && HEX_KEY.test(server.pubkey) && validServers(server.relays ?? [])
    && Array.isArray(tools) && tools.length > 0 && tools.length <= 64
    && tools.every((tool) => text(tool.name) && HEX_KEY.test(tool.schemaHash))
    && new Set(tools.map((tool) => tool.name)).size === tools.length;
}

function read(raw: Partial<MultiplayerState>): MultiplayerState {
  const families = Array.isArray(raw.families) ? raw.families.filter(validFamily).slice(0, 16) : [];
  return Object.freeze({
    ...(Array.isArray(raw.servers) && validServers(raw.servers) ? { servers: raw.servers } : {}),
    ...(Array.isArray(raw.helpers) && raw.helpers.every(validHelper) ? { helpers: raw.helpers } : {}),
    families,
  });
}

/**
 * The person's own settings for meeting people and calling remote tools, kept
 * on this device. They override the host's defaults: the person chooses the
 * servers that introduce them, whether anything helps their connections
 * through, and which tool families they trust (D-043). A stored value that
 * fails validation is read as unset rather than trusted.
 *
 * @param storage - Where the settings are kept, under `kernl:multiplayer:v1`.
 * @returns The settings.
 * @example
 * ```ts
 * const settings = createMultiplayerSettings(localStorage);
 * settings.setServers(['wss://meet.example']);
 * ```
 */
export function createMultiplayerSettings(storage: StorageLike): MultiplayerSettings {
  const store = createNamespacedStore(storage, 'kernl');
  const state$ = new BehaviorSubject<MultiplayerState>(read(store.getJson<Partial<MultiplayerState>>(STORAGE_KEY, {})));
  const commit = (next: Partial<MultiplayerState>): void => {
    const state = read(next);
    store.setJson(STORAGE_KEY, state);
    state$.next(state);
  };
  const without = (key: 'servers' | 'helpers'): Partial<MultiplayerState> => {
    const { [key]: _dropped, ...rest } = state$.value;
    return rest;
  };
  return {
    state$: state$.asObservable(),
    state: () => state$.value,
    setServers(urls) {
      if (urls && !validServers(urls)) throw new Error('invalid:relay-url');
      commit(urls ? { ...state$.value, servers: [...new Set(urls)] } : without('servers'));
    },
    setHelpers(helpers) {
      if (helpers && !(helpers.length <= 8 && helpers.every(validHelper))) throw new Error('invalid:helper');
      commit(helpers ? { ...state$.value, helpers } : without('helpers'));
    },
    saveFamily(family) {
      if (!validFamily(family)) throw new Error('invalid:family');
      const others = state$.value.families.filter((saved) => saved.family !== family.family || saved.server.pubkey !== family.server.pubkey);
      if (others.length >= 16) throw new Error('invalid:family');
      commit({ ...state$.value, families: [...others, family] });
    },
    removeFamily(label, pubkey) {
      commit({ ...state$.value, families: state$.value.families.filter((saved) => saved.family !== label || saved.server.pubkey !== pubkey) });
    },
  };
}
