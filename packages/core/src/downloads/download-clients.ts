import { BehaviorSubject, type Observable } from 'rxjs';
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
  type ClientProbe,
  type EndpointNote,
  type NzbClient,
  type PageScheme,
  type SoulseekClient,
  type TorrentClient,
} from '@kernlize/bridges';
import { createNamespacedStore } from '../persistence/store.js';
import { createStorageSecrets, type SecretsProvider } from '../secrets/secrets.js';
import type { StorageLike } from '../types.js';
import type { NzbDownloader } from './nzb-service.js';

const STORAGE_KEY = 'download-programs:v1';
const MAX_SECRET_LENGTH = 512;
const SECRET_FIELDS = ['password', 'apiKey'] as const;

/** A program kernl can drive for the person, by the name it is known by. */
export type DownloadProgram = 'transmission' | 'utorrent' | 'nzbget' | 'sabnzbd' | 'slskd';

/** The programs that speak to peers in a swarm; one of them serves the `torrent` domain at a time. */
export type TorrentProgram = Extract<DownloadProgram, 'transmission' | 'utorrent'>;

/** What a program is for, and what it asks for before it answers. */
export interface DownloadProgramInfo {
  /** The NAP domain the program serves. */
  readonly domain: 'torrent' | 'nzb' | 'soulseek';
  /** The program's own name, as its makers write it. */
  readonly name: string;
  /** Which sign-in fields the program takes. */
  readonly signIn: readonly ('username' | 'password' | 'apiKey')[];
  /** An address the program answers at when it runs on this device with its usual settings. */
  readonly example: string;
}

/**
 * Every program kernl can drive, with the domain it serves and the sign-in it takes.
 *
 * @example
 * ```ts
 * DOWNLOAD_PROGRAMS.sabnzbd.signIn; // ['apiKey']
 * DOWNLOAD_PROGRAMS.transmission.domain; // 'torrent'
 * ```
 */
export const DOWNLOAD_PROGRAMS: Readonly<Record<DownloadProgram, DownloadProgramInfo>> = Object.freeze({
  transmission: { domain: 'torrent', name: 'Transmission', signIn: ['username', 'password'], example: 'http://localhost:9091' },
  utorrent: { domain: 'torrent', name: 'uTorrent', signIn: ['username', 'password'], example: 'http://localhost:8080' },
  nzbget: { domain: 'nzb', name: 'NZBGet', signIn: ['username', 'password'], example: 'http://localhost:6789' },
  sabnzbd: { domain: 'nzb', name: 'SABnzbd', signIn: ['apiKey'], example: 'http://localhost:8080' },
  slskd: { domain: 'soulseek', name: 'slskd', signIn: ['apiKey', 'username', 'password'], example: 'http://localhost:5030' },
});

/** What the person types for a program: its address and its sign-in. */
export type DownloadSignIn = ClientEndpoint;

/** What is kept in settings and shown for a program. It never holds a secret, only whether one is kept. */
export interface DownloadConnection {
  readonly url: string;
  readonly username?: string;
  readonly hasPassword: boolean;
  readonly hasApiKey: boolean;
}

/** What the person set up on this device. */
export interface DownloadClientsState {
  readonly connections: Readonly<Partial<Record<DownloadProgram, DownloadConnection>>>;
  /** Which torrent program serves applets when both are set up; the only one set up otherwise. */
  readonly torrentProgram?: TorrentProgram;
  /** Programs whose kept sign-in the secrets provider would not hand over; they serve nobody until it does. */
  readonly locked: readonly DownloadProgram[];
}

/** A sign-in that was checked and answered. */
export interface CheckedConnection {
  /** The sign-in as it should be saved: the address with its scheme worked out, and what was typed. */
  readonly signIn: DownloadSignIn;
  /** What the person should know about the address, such as that it is not encrypted. */
  readonly notes: readonly EndpointNote[];
  readonly probe: ClientProbe;
}

/** The person's download programs: what is set up, and the live clients the services call. */
export interface DownloadClients {
  readonly state$: Observable<DownloadClientsState>;
  state(): DownloadClientsState;
  /** Settles once the kept sign-ins have been asked for from the secrets provider; clients are offered from then on. */
  readonly ready: Promise<void>;
  /**
   * Work out the address's scheme when none was typed, check it against how kernl is served,
   * and ask the program whether it is there. A password or key left empty is the kept one,
   * but only for the address it was kept for. Saves nothing. Rejects with the reason a person
   * can be told: `invalid:…` for the address, `denied:credentials`, `unavailable:…`.
   */
  check(program: DownloadProgram, typed: DownloadSignIn): Promise<CheckedConnection>;
  /**
   * Keep a sign-in: the address and name in settings, the password and key with the secrets
   * provider. A secret left empty is kept for the same address and forgotten for a new one.
   * Rejects `invalid:…` when the address or sign-in cannot be used from this page, and with
   * the provider's reason when it will not keep the secret; nothing is saved then.
   */
  save(program: DownloadProgram, signIn: DownloadSignIn): Promise<void>;
  /** Forget a program and its kept secrets. */
  remove(program: DownloadProgram): Promise<void>;
  /** Choose which torrent program serves applets. Throws `invalid:program` when it is not set up. */
  chooseTorrent(program: TorrentProgram): void;
  /** The torrent client applets are served by, or undefined when none is set up. */
  torrent(): TorrentClient | undefined;
  /** Every NZB downloader that is set up. */
  nzb(): readonly NzbDownloader[];
  /** The Soulseek daemon applets are served by, or undefined when none is set up. */
  soulseek(): SoulseekClient | undefined;
}

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

const FACTORIES: Readonly<Record<DownloadProgram, (options: { endpoint: ClientEndpoint; fetch?: ClientFetch }) => AnyClient>> = {
  transmission: createTransmissionClient,
  utorrent: createUtorrentClient,
  nzbget: createNzbgetClient,
  sabnzbd: createSabnzbdClient,
  slskd: createSlskdClient,
};

const PROGRAMS = Object.keys(DOWNLOAD_PROGRAMS) as readonly DownloadProgram[];
const TORRENT_PROGRAMS: readonly TorrentProgram[] = ['transmission', 'utorrent'];

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

type Secrets = Readonly<Partial<Record<(typeof SECRET_FIELDS)[number], string>>>;
type Connections = Partial<Record<DownloadProgram, DownloadConnection>>;

const text = (value: unknown): value is string | undefined => value === undefined || (typeof value === 'string' && value.length <= MAX_SECRET_LENGTH);

/** The name a program's secret is kept under with the provider. */
const secretName = (program: DownloadProgram, field: (typeof SECRET_FIELDS)[number]): string => `download:${program}:${field}`;

/** The sign-in with its address replaced and empty fields dropped, or a thrown `invalid:sign-in` when a field is not text of a sane length. */
function tidy(signIn: DownloadSignIn, url: string): DownloadSignIn {
  const { username, password, apiKey } = signIn;
  if (!text(username) || !text(password) || !text(apiKey)) throw new Error('invalid:sign-in');
  return { url, ...(username ? { username } : {}), ...(password ? { password } : {}), ...(apiKey ? { apiKey } : {}) };
}

/** What was stored, when it is still a connection this page may use; undefined otherwise, so nothing stored is trusted as it stands. */
function usable(value: unknown, page: PageScheme): DownloadConnection | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<DownloadConnection>;
  const checked = typeof candidate.url === 'string' ? checkClientEndpoint(candidate.url, page) : undefined;
  if (!checked?.ok || !text(candidate.username)) return undefined;
  return { url: checked.url, ...(candidate.username ? { username: candidate.username } : {}), hasPassword: candidate.hasPassword === true, hasApiKey: candidate.hasApiKey === true };
}

function readStored(value: unknown, page: PageScheme): DownloadClientsState {
  const stored = (typeof value === 'object' && value !== null ? value : {}) as { connections?: unknown; torrentProgram?: unknown };
  const raw = (typeof stored.connections === 'object' && stored.connections !== null ? stored.connections : {}) as Record<string, unknown>;
  const connections: Connections = {};
  for (const program of PROGRAMS) {
    const kept = usable(raw[program], page);
    if (kept) connections[program] = kept;
  }
  return withTorrentChoice(connections, stored.torrentProgram, []);
}

function withTorrentChoice(connections: Connections, wanted: unknown, locked: readonly DownloadProgram[]): DownloadClientsState {
  const setUp = TORRENT_PROGRAMS.filter((program) => connections[program] !== undefined);
  const torrentProgram = setUp.find((program) => program === wanted) ?? setUp[0];
  return torrentProgram ? { connections, torrentProgram, locked } : { connections, locked };
}

/**
 * The programs the person set up for kernl to download with, and the live clients the
 * `torrent`, `nzb` and `soulseek` services call.
 *
 * Addresses and names are kept on this device at `kernl:download-programs:v1`. Passwords
 * and keys are not: they go to the secrets provider and are held in memory only for the
 * clients that sign in with them, so nothing that reads settings, the settings form
 * included, is ever handed one (D-052). Until the provider has answered for the kept
 * sign-ins, and for any it will not hand over, no client is offered for that program.
 *
 * An address is checked against how kernl itself is served before it is kept or used: a
 * page loaded over `https` may call a plain `http` address only on this device, so anything
 * else is refused as `invalid:mixed-content` rather than saved to fail later. An address
 * typed without a scheme has it worked out by asking the program, `https` first. Sign-in
 * details never go into the address. What comes back out of storage is checked again and
 * dropped when it no longer passes.
 *
 * @param options - Storage, and optionally the secrets provider, how the page was loaded and the `fetch` to use.
 * @returns The settings and the clients built from them.
 * @example
 * ```ts
 * const programs = createDownloadClients({ storage: localStorage });
 * const { signIn } = await programs.check('transmission', { url: 'localhost:9091', username: 'me', password: 'secret' });
 * await programs.save('transmission', signIn);
 * await programs.torrent()?.list();
 * ```
 */
export function createDownloadClients(options: DownloadClientsOptions): DownloadClients {
  const store = createNamespacedStore(options.storage, 'kernl');
  const secrets = options.secrets ?? createStorageSecrets(options.storage);
  const page = options.pageScheme ?? currentPageScheme;
  const state$ = new BehaviorSubject<DownloadClientsState>(readStored(store.getJson<unknown>(STORAGE_KEY, {}), page()));
  const held = new Map<DownloadProgram, Secrets>();
  const clients = new Map<DownloadProgram, { readonly connection: DownloadConnection; readonly secrets: Secrets; readonly client: AnyClient }>();

  const build = (program: DownloadProgram, endpoint: ClientEndpoint): AnyClient => FACTORIES[program]({ endpoint, ...(options.fetch ? { fetch: options.fetch } : {}) });

  /** One client per saved sign-in, so a client's signed-in session lasts until the sign-in changes. */
  function clientFor<T extends AnyClient>(program: DownloadProgram): T | undefined {
    const connection = state$.value.connections[program];
    const kept = held.get(program);
    if (!connection || !kept) return undefined;
    const cached = clients.get(program);
    if (cached?.connection === connection && cached.secrets === kept) return cached.client as T;
    const client = build(program, { url: connection.url, ...(connection.username ? { username: connection.username } : {}), ...kept });
    clients.set(program, { connection, secrets: kept, client });
    return client as T;
  }

  function commit(connections: Connections, wanted: unknown, locked: readonly DownloadProgram[] = state$.value.locked): void {
    const next = withTorrentChoice(connections, wanted, locked);
    const { locked: _session, ...kept } = next;
    store.setJson(STORAGE_KEY, kept);
    state$.next(next);
  }

  /** What is typed, with a secret left empty filled from what is kept for exactly this address. */
  function withKept(program: DownloadProgram, typed: DownloadSignIn, url: string): DownloadSignIn {
    const kept = state$.value.connections[program]?.url === url ? held.get(program) : undefined;
    const password = typed.password || kept?.password;
    const apiKey = typed.apiKey || kept?.apiKey;
    return tidy({ url, ...(typed.username ? { username: typed.username } : {}), ...(password ? { password } : {}), ...(apiKey ? { apiKey } : {}) }, url);
  }

  async function load(program: DownloadProgram, connection: DownloadConnection): Promise<void> {
    try {
      const [password, apiKey] = await Promise.all([connection.hasPassword ? secrets.get(secretName(program, 'password')) : undefined, connection.hasApiKey ? secrets.get(secretName(program, 'apiKey')) : undefined]);
      held.set(program, { ...(password ? { password } : {}), ...(apiKey ? { apiKey } : {}) });
    } catch {
      state$.next({ ...state$.value, locked: [...state$.value.locked, program] });
    }
  }

  const ready = Promise.all(PROGRAMS.map((program) => {
    const connection = state$.value.connections[program];
    return connection ? load(program, connection) : undefined;
  })).then(() => undefined);

  return {
    state$: state$.asObservable(),
    state: () => state$.value,
    ready,
    async check(program, typed) {
      await ready;
      let signIn = typed;
      const { endpoint, result } = await detectClientEndpoint(typed.url, page(), (url) => {
        signIn = withKept(program, typed, url);
        return build(program, signIn).probe();
      });
      return { signIn: { ...signIn, url: endpoint.url }, notes: endpoint.notes, probe: result };
    },
    async save(program, typed) {
      await ready;
      const checked = checkClientEndpoint(typed.url, page());
      if (!checked.ok) throw new Error(checked.reason);
      const signIn = withKept(program, typed, checked.url);
      // The provider keeps the secrets before settings say they are kept, so a refusal leaves what was there.
      await Promise.all(SECRET_FIELDS.map((field) => (signIn[field] ? secrets.set(secretName(program, field), signIn[field]) : secrets.delete(secretName(program, field)))));
      held.set(program, { ...(signIn.password ? { password: signIn.password } : {}), ...(signIn.apiKey ? { apiKey: signIn.apiKey } : {}) });
      const connection: DownloadConnection = { url: signIn.url, ...(signIn.username ? { username: signIn.username } : {}), hasPassword: signIn.password !== undefined, hasApiKey: signIn.apiKey !== undefined };
      commit({ ...state$.value.connections, [program]: connection }, state$.value.torrentProgram, state$.value.locked.filter((entry) => entry !== program));
    },
    async remove(program) {
      await ready;
      await Promise.all(SECRET_FIELDS.map((field) => secrets.delete(secretName(program, field))));
      const { [program]: _removed, ...rest } = state$.value.connections;
      held.delete(program);
      clients.delete(program);
      commit(rest, state$.value.torrentProgram, state$.value.locked.filter((entry) => entry !== program));
    },
    chooseTorrent(program) {
      if (!state$.value.connections[program]) throw new Error('invalid:program');
      commit(state$.value.connections, program);
    },
    torrent: () => (state$.value.torrentProgram ? clientFor<TorrentClient>(state$.value.torrentProgram) : undefined),
    nzb: () =>
      (['nzbget', 'sabnzbd'] as const).flatMap((program) => {
        const client = clientFor<NzbClient>(program);
        return client ? [{ key: program, label: DOWNLOAD_PROGRAMS[program].name, client }] : [];
      }),
    soulseek: () => clientFor<SoulseekClient>('slskd'),
  };
}
