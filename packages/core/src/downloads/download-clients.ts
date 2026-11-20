import { BehaviorSubject } from 'rxjs';
import {
  checkClientEndpoint,
  createNzbgetClient,
  createSabnzbdClient,
  createSlskdClient,
  createTransmissionClient,
  createUtorrentClient,
  detectClientEndpoint,
  type ClientEndpoint,
  type ClientFetch,
  type NzbClient,
  type PageScheme,
  type SoulseekClient,
  type TorrentClient,
} from '@kernlize/bridges';
import { createNamespacedStore } from '../persistence/store.js';
import { createStorageSecrets, type SecretsProvider } from '../secrets/secrets.js';
import type { StorageLike } from '../types.js';
import type { ClientFor, ConnectionRouting, DownloadClients, DownloadClientsState, DownloadConnection, DownloadDomain, DownloadProgram, DownloadSignIn, RoutedClient } from './connections.js';
import { defaultLabel, domainOf, isSignInText, labelFrom, nextRoutingKey, readStoredState, successor, withDefaults } from './download-records.js';

export type { CheckedConnection, ClientFor, ConnectionChange, ConnectionRouting, DownloadClients, DownloadClientsState, DownloadConnection, DownloadDomain, DownloadProgram, DownloadSignIn, RoutedClient, RoutedDomain } from './connections.js';
export { DOWNLOAD_PROGRAMS, type DownloadProgramInfo } from './download-records.js';

const STORAGE_KEY = 'download-programs:v1';
const SECRET_FIELDS = ['password', 'apiKey'] as const;

/** Options for {@link createDownloadClients}. */
export interface DownloadClientsOptions {
  readonly storage: StorageLike;
  /** Where passwords and keys are kept; the host's storage, as typed, by default. */
  readonly secrets?: SecretsProvider;
  /** How the page running kernl was loaded; read from `location` by default, `http` where there is none. */
  readonly pageScheme?: () => PageScheme;
  /** `fetch` for every program; the global one by default. */
  readonly fetch?: ClientFetch;
}

type AnyClient = TorrentClient | NzbClient | SoulseekClient;
type SecretField = (typeof SECRET_FIELDS)[number];
type Secrets = Readonly<Partial<Record<SecretField, string>>>;

/** A built client and what it was built from, so it is rebuilt only when one of those changes. */
interface Built {
  readonly url: string;
  readonly username: string | undefined;
  readonly secrets: Secrets;
  readonly client: AnyClient;
}

const FACTORIES: Readonly<Record<DownloadProgram, (options: { endpoint: ClientEndpoint; fetch?: ClientFetch }) => AnyClient>> = {
  transmission: createTransmissionClient,
  utorrent: createUtorrentClient,
  nzbget: createNzbgetClient,
  sabnzbd: createSabnzbdClient,
  slskd: createSlskdClient,
};

/**
 * How the page running the shell was loaded, from `location`. Where there is no page, as in a
 * host outside a browser, nothing restricts which addresses can be called, which is `http`'s rule.
 *
 * @returns `https` for a page loaded over it, otherwise `http`.
 * @example
 * ```ts
 * currentPageScheme(); // 'https' on https://kernl.run/app/
 * ```
 */
export function currentPageScheme(): PageScheme {
  return (globalThis as { location?: { protocol?: string } }).location?.protocol === 'https:' ? 'https' : 'http';
}

/** The name a connection's secret is kept under with the provider. */
const secretName = (id: string, field: SecretField): string => `download:${id}:${field}`;

const secretsOf = (signIn: DownloadSignIn): Secrets => ({ ...(signIn.password ? { password: signIn.password } : {}), ...(signIn.apiKey ? { apiKey: signIn.apiKey } : {}) });

/** The sign-in with its address replaced and empty fields dropped, or a thrown `invalid:sign-in` when a field is not text of a sane length. */
function tidy(signIn: DownloadSignIn, url: string): DownloadSignIn {
  const { username, password, apiKey } = signIn;
  if (!isSignInText(username) || !isSignInText(password) || !isSignInText(apiKey)) throw new Error('invalid:sign-in');
  return { url, ...(username ? { username } : {}), ...secretsOf(signIn) };
}

/** The address as this page may call it, or the thrown reason it may not. */
function callable(url: string, page: PageScheme): string {
  const checked = checkClientEndpoint(url, page);
  if (!checked.ok) throw new Error(checked.reason);
  return checked.url;
}

/** What is typed, with a secret left empty filled from what is kept for exactly this address of this connection. */
function withKeptSecrets(kept: Secrets | undefined, typed: DownloadSignIn, url: string): DownloadSignIn {
  const password = typed.password || kept?.password;
  const apiKey = typed.apiKey || kept?.apiKey;
  return tidy({ url, ...(typed.username === undefined ? {} : { username: typed.username }), ...(password ? { password } : {}), ...(apiKey ? { apiKey } : {}) }, url);
}

/** One domain's routing, reading the settings on every call so an edit or removal is seen at once. */
function routingOver<D extends DownloadDomain>(state: () => DownloadClientsState, clientOf: (connection: DownloadConnection) => AnyClient | undefined, domain: D): ConnectionRouting<ClientFor<D>> {
  const all = (): RoutedClient<ClientFor<D>>[] =>
    state().connections.flatMap((connection) => {
      const client = domainOf(connection.program) === domain ? clientOf(connection) : undefined;
      return client ? [{ connection, client: client as ClientFor<D> }] : [];
    });
  return {
    all,
    byId: (id) => all().find((routed) => routed.connection.id === id),
    preferred() {
      const serving = all();
      const chosen = (state().defaults as Readonly<Record<string, string | undefined>>)[domain];
      return serving.find((routed) => routed.connection.id === chosen) ?? serving[0];
    },
  };
}

/** What settings keep for a connection signed in to as `signIn`. */
function described(base: Pick<DownloadConnection, 'id' | 'program' | 'label' | 'routingKey'>, signIn: DownloadSignIn): DownloadConnection {
  const { id, program, label, routingKey } = base;
  return { id, program, label, url: signIn.url, ...(signIn.username ? { username: signIn.username } : {}), hasPassword: signIn.password !== undefined, hasApiKey: signIn.apiKey !== undefined, routingKey };
}

/**
 * The person's download connections, and the routing the `torrent`, `nzb` and `soulseek`
 * services read (D-050, D-053). A person may set up any number of connections, several of the
 * same program among them; each has a random id and a label of their own.
 *
 * Addresses, usernames and labels are kept on this device at `kernl:download-programs:v1`.
 * Passwords and keys are not: they go to the secrets provider under
 * `download:<connection id>:password` and `…:apiKey`, and are held in memory only for the
 * clients that sign in with them, so nothing that reads settings, the settings form included,
 * is ever handed one (D-052). A connection serves nobody until the provider has answered for
 * its kept sign-in, and none whose sign-in the provider will not hand over (it is `locked`).
 *
 * An address is checked against how kernl itself is served before it is kept or used: a page
 * loaded over `https` may call a plain `http` address only on this device, so anything else is
 * refused as `invalid:mixed-content`. An address typed without a scheme has it worked out by
 * asking the program, `https` first. What comes back out of storage is checked again and
 * dropped when it no longer passes.
 *
 * @param options - Storage, and optionally the secrets provider, how the page was loaded and the `fetch` to use.
 * @returns The settings and the routing built from them.
 * @example
 * ```ts
 * const programs = createDownloadClients({ storage: localStorage });
 * const { signIn } = await programs.check('transmission', { url: 'localhost:9091', username: 'me', password: 'secret' });
 * const home = await programs.add('transmission', signIn, 'Home');
 * await programs.routing('torrent').byId(home.id)?.client.list();
 * ```
 */
export function createDownloadClients(options: DownloadClientsOptions): DownloadClients {
  const store = createNamespacedStore(options.storage, 'kernl');
  const secrets = options.secrets ?? createStorageSecrets(options.storage);
  const page = options.pageScheme ?? currentPageScheme;
  const state$ = new BehaviorSubject<DownloadClientsState>(readStoredState(store.getJson<unknown>(STORAGE_KEY, {}), page()));
  const held = new Map<string, Secrets>();
  const built = new Map<string, Built>();

  const build = (program: DownloadProgram, endpoint: ClientEndpoint): AnyClient => FACTORIES[program]({ endpoint, ...(options.fetch ? { fetch: options.fetch } : {}) });

  /** One client per connection, so its signed-in session lasts until the address, username or secrets change; a label does not count. */
  function clientOf(connection: DownloadConnection): AnyClient | undefined {
    const kept = held.get(connection.id);
    if (!kept) return undefined;
    const cached = built.get(connection.id);
    if (cached?.url === connection.url && cached.username === connection.username && cached.secrets === kept) return cached.client;
    const client = build(connection.program, { url: connection.url, ...(connection.username ? { username: connection.username } : {}), ...kept });
    built.set(connection.id, { url: connection.url, username: connection.username, secrets: kept, client });
    return client;
  }

  function commit(connections: readonly DownloadConnection[], wanted: Readonly<Record<string, unknown>> = state$.value.defaults, locked: readonly string[] = state$.value.locked): void {
    const next = withDefaults(connections, wanted, locked);
    store.setJson(STORAGE_KEY, { connections: next.connections, defaults: next.defaults });
    state$.next(next);
  }

  const find = (id: string): DownloadConnection | undefined => state$.value.connections.find((connection) => connection.id === id);
  function known(id: string, program?: DownloadProgram): DownloadConnection {
    const connection = find(id);
    if (!connection || (program !== undefined && connection.program !== program)) throw new Error('invalid:connection');
    return connection;
  }

  const withKept = (existing: DownloadConnection | undefined, typed: DownloadSignIn, url: string): DownloadSignIn => withKeptSecrets(existing?.url === url ? held.get(existing.id) : undefined, typed, url);

  /** The provider keeps the secrets before settings say they are kept, so a refusal leaves what was there. */
  async function keep(id: string, signIn: DownloadSignIn): Promise<void> {
    await Promise.all(SECRET_FIELDS.map((field) => (signIn[field] ? secrets.set(secretName(id, field), signIn[field]) : secrets.delete(secretName(id, field)))));
    held.set(id, secretsOf(signIn));
  }

  async function load(connection: DownloadConnection): Promise<void> {
    const ask = (field: SecretField, kept: boolean): Promise<string | undefined> | undefined => (kept ? secrets.get(secretName(connection.id, field)) : undefined);
    try {
      const [password, apiKey] = await Promise.all([ask('password', connection.hasPassword), ask('apiKey', connection.hasApiKey)]);
      // A secret settings say is kept and the provider no longer has is gone, not empty: signing in without it would only be refused.
      if ((connection.hasPassword && !password) || (connection.hasApiKey && !apiKey)) throw new Error('unavailable:secrets');
      held.set(connection.id, { ...(password ? { password } : {}), ...(apiKey ? { apiKey } : {}) });
    } catch {
      state$.next({ ...state$.value, locked: [...state$.value.locked, connection.id] });
    }
  }

  const ready = Promise.all(state$.value.connections.map(load)).then(() => undefined);

  return {
    state$: state$.asObservable(),
    state: () => state$.value,
    ready,
    async check(program, typed, existing) {
      await ready;
      const kept = existing === undefined ? undefined : known(existing, program);
      let signIn = typed;
      const { endpoint, result } = await detectClientEndpoint(typed.url, page(), (url) => {
        signIn = withKept(kept, typed, url);
        return build(program, signIn).probe();
      });
      return { signIn: { ...signIn, url: endpoint.url }, notes: endpoint.notes, probe: result };
    },
    async add(program, typed, label) {
      await ready;
      const url = callable(typed.url, page());
      const name = label === undefined ? defaultLabel(program, state$.value.connections) : labelFrom(label);
      const signIn = withKept(undefined, typed, url);
      const id = crypto.randomUUID();
      await keep(id, signIn);
      const connection = described({ id, program, label: name, routingKey: `${id}:0` }, signIn);
      commit([...state$.value.connections, connection]);
      return connection;
    },
    async update(id, change) {
      await ready;
      const current = known(id);
      const label = change.label === undefined ? current.label : labelFrom(change.label);
      let next: DownloadConnection = { ...current, label };
      let locked = state$.value.locked;
      if (change.signIn) {
        const signIn = withKept(current, change.signIn, callable(change.signIn.url, page()));
        await keep(id, signIn);
        next = described({ ...next, routingKey: signIn.url === current.url ? current.routingKey : nextRoutingKey(current) }, signIn);
        locked = locked.filter((entry) => entry !== id);
      }
      commit(state$.value.connections.map((connection) => (connection.id === id ? next : connection)), state$.value.defaults, locked);
      return next;
    },
    async remove(id) {
      await ready;
      const current = find(id);
      if (!current) return;
      await Promise.all(SECRET_FIELDS.map((field) => secrets.delete(secretName(id, field))));
      held.delete(id);
      built.delete(id);
      const { connections, defaults, locked } = state$.value;
      const wanted: Record<string, unknown> = { ...defaults };
      const domain = domainOf(current.program);
      if (wanted[domain] === id) wanted[domain] = successor(connections, current)?.id;
      commit(connections.filter((connection) => connection.id !== id), wanted, locked.filter((entry) => entry !== id));
    },
    chooseDefault(domain, id) {
      const connection = find(id);
      if (!connection || domainOf(connection.program) !== domain) throw new Error('invalid:connection');
      commit(state$.value.connections, { ...state$.value.defaults, [domain]: id });
    },
    routing: (domain) => routingOver(() => state$.value, clientOf, domain),
  };
}
