import type { Observable } from 'rxjs';
import type { ClientEndpoint, ClientProbe, EndpointNote, NzbClient, SoulseekClient, TorrentClient } from '@kernlize/bridges';

/**
 * The shapes the person's download connections take (D-053). A person may set up any number
 * of connections, several of the same program among them; kernl routes each applet's work to
 * one. These types are the contract between the settings store, the three services and the
 * settings form.
 */

/** A program kernl can drive for the person, by the name it is known by. */
export type DownloadProgram = 'transmission' | 'utorrent' | 'nzbget' | 'sabnzbd' | 'slskd';

/** The NAP domains the programs serve. */
export type DownloadDomain = 'torrent' | 'nzb' | 'soulseek';

/** The domains where kernl, not the applet, picks the connection new work goes to. */
export type RoutedDomain = Extract<DownloadDomain, 'torrent' | 'soulseek'>;

/** The client contract each domain's programs speak. */
export type ClientFor<D extends DownloadDomain> = D extends 'torrent' ? TorrentClient : D extends 'nzb' ? NzbClient : SoulseekClient;

/** What the person types for a connection: its address and its sign-in. */
export type DownloadSignIn = ClientEndpoint;

/** One connection to one program, as settings keep it. It never holds a secret, only whether one is kept. */
export interface DownloadConnection {
  /** Shell-issued and random; stable for the connection's life, whatever is edited. Never shown and never sent to an applet. */
  readonly id: string;
  readonly program: DownloadProgram;
  /** The person's name for it, 1 to 60 characters; the program's name, numbered when taken, until they change it. */
  readonly label: string;
  readonly url: string;
  readonly username?: string;
  readonly hasPassword: boolean;
  readonly hasApiKey: boolean;
  /**
   * Changes whenever the address changes. Services key what they hand applets by it, so a handle
   * issued for jobs at the old address can never reach a different server's job with the same id.
   */
  readonly routingKey: string;
}

/** What the person set up on this device. */
export interface DownloadClientsState {
  /** Every connection, in the order it was added. */
  readonly connections: readonly DownloadConnection[];
  /** Which connection new torrents and new searches go to, by connection id. The first of a kind until the person chooses. */
  readonly defaults: Readonly<Partial<Record<RoutedDomain, string>>>;
  /** Connections whose kept sign-in the secrets provider would not hand over, or no longer has, by id; they serve nobody until signed in to again. */
  readonly locked: readonly string[];
}

/** A connection with the live client that speaks to it. */
export interface RoutedClient<T> {
  readonly connection: DownloadConnection;
  readonly client: T;
}

/**
 * How a service reaches one domain's connections. It is read on every call, so a connection the
 * person edits or removes is seen at once: a record keeps a connection id and resolves it each time.
 */
export interface ConnectionRouting<T> {
  /** Every connection that can serve now (set up and not locked), in the order added. */
  all(): readonly RoutedClient<T>[];
  /** One connection by id; undefined when it was removed or is locked. */
  byId(id: string): RoutedClient<T> | undefined;
  /** Where new work goes: the person's default for the domain, else the first that can serve. Undefined when none can. */
  preferred(): RoutedClient<T> | undefined;
}

/** A sign-in that was checked and answered. */
export interface CheckedConnection {
  /** The sign-in as it should be saved: the address with its scheme worked out, and what was typed. */
  readonly signIn: DownloadSignIn;
  /** What the person should know about the address, such as that it is not encrypted. */
  readonly notes: readonly EndpointNote[];
  readonly probe: ClientProbe;
}

/** A change to an existing connection; what is left out stays as it is. */
export interface ConnectionChange {
  readonly label?: string;
  /** A secret left empty is the kept one for the same address, and is forgotten for a new one. */
  readonly signIn?: DownloadSignIn;
}

/** The person's download connections, and the routing the services read. */
export interface DownloadClients {
  readonly state$: Observable<DownloadClientsState>;
  state(): DownloadClientsState;
  /** Settles once the kept sign-ins have been asked for from the secrets provider; connections serve from then on. */
  readonly ready: Promise<void>;
  /**
   * Work out the address's scheme when none was typed, check it against how kernl is served, and
   * ask the program whether it is there. Saves nothing. With `existing`, a password or key left
   * empty is that connection's kept one, but only for the address it was kept for. Rejects with
   * the reason a person can be told: `invalid:…`, `denied:credentials`, `unavailable:…`.
   */
  check(program: DownloadProgram, typed: DownloadSignIn, existing?: string): Promise<CheckedConnection>;
  /**
   * Keep a new connection. Its label defaults to the program's name, numbered when taken. Rejects
   * `invalid:…` when the address, label or sign-in cannot be used from this page, and with the
   * secrets provider's reason when it will not keep a secret; nothing is saved then.
   */
  add(program: DownloadProgram, signIn: DownloadSignIn, label?: string): Promise<DownloadConnection>;
  /** Change a connection's label or sign-in. A new address gives it a new `routingKey`. Rejects `invalid:connection` for an unknown id. */
  update(id: string, change: ConnectionChange): Promise<DownloadConnection>;
  /** Forget a connection and its kept secrets. Removing a domain's default makes the next of its kind the default. */
  remove(id: string): Promise<void>;
  /** Choose where new work for a domain goes. Throws `invalid:connection` when the id is not a connection serving that domain. */
  chooseDefault(domain: RoutedDomain, id: string): void;
  /** The routing one domain's service reads. */
  routing<D extends DownloadDomain>(domain: D): ConnectionRouting<ClientFor<D>>;
}
