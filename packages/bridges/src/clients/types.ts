/**
 * Contracts for the programs a person already runs to download things: a torrent
 * client, an NZB downloader, a Soulseek daemon. kernl drives each through the
 * program's own HTTP API; these shapes are what every adapter normalises to, so the
 * shell's services never see a backend's method names, ids or paths.
 *
 * Every adapter method rejects with an `Error` whose message starts with a stable
 * reason from {@link ClientFailure}; nothing else is thrown past an adapter.
 */

/** Where a client program answers, and what it asks for before it does. */
export interface ClientEndpoint {
  /** Absolute `http:` or `https:` address of the program's web interface, without credentials, query or fragment. */
  readonly url: string;
  readonly username?: string;
  readonly password?: string;
  /** For programs that take a key instead of, or beside, a name and password. */
  readonly apiKey?: string;
}

/** `fetch` as an adapter calls it; the page's own by default, a host's where the page has none. */
export type ClientFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What every adapter factory takes. */
export interface ClientOptions {
  readonly endpoint: ClientEndpoint;
  readonly fetch?: ClientFetch;
  /** How long one request may take before it fails as `unavailable:timeout`; 15 000 ms by default. */
  readonly timeoutMs?: number;
}

/**
 * The reasons an adapter rejects with, as the start of `Error.message`:
 *
 * - `unavailable:unreachable` the request never got an answer (refused, blocked by the browser, DNS).
 * - `unavailable:timeout` no answer within `timeoutMs`.
 * - `denied:credentials` the program refused the name, password or key.
 * - `unavailable:bad-response` the program answered with something the adapter cannot read.
 * - `unavailable:rejected` the program conclusively declined the request and changed nothing.
 * - `unavailable:not-found` the program does not know the job, search or transfer named.
 * - `unavailable:unsupported` this program, or this version of it, cannot do what was asked.
 * - `unavailable:outcome-unknown` a change was sent and may have applied, but could not be confirmed.
 * - `unavailable:peer-unavailable` a peer on the sharing network could not be reached.
 * - `denied:peer` a peer on the sharing network refused.
 * - `invalid:<what>` the caller's input was wrong; nothing was sent.
 */
export type ClientFailure =
  | 'unavailable:unreachable'
  | 'unavailable:timeout'
  | 'denied:credentials'
  | 'unavailable:bad-response'
  | 'unavailable:rejected'
  | 'unavailable:not-found'
  | 'unavailable:unsupported'
  | 'unavailable:outcome-unknown'
  | 'unavailable:peer-unavailable'
  | 'denied:peer'
  | `invalid:${string}`;

/** What a program says about itself when asked whether it is there. */
export interface ClientProbe {
  /** The program's own version string, as it reports it. */
  readonly version: string;
}

/** A torrent's phase, as NAP-TORRENT names job states the client can report. */
export type TorrentClientState = 'queued' | 'metadata' | 'downloading' | 'seeding' | 'paused' | 'complete' | 'error';

/** One torrent as the client reports it. */
export interface TorrentClientJob {
  /** Lowercase 40-character hexadecimal v1 info hash; the id every other method takes. */
  readonly infoHash: string;
  readonly name: string;
  readonly state: TorrentClientState;
  readonly downloadedBytes: number;
  readonly uploadedBytes: number;
  /** Absent until the client knows the torrent's size. */
  readonly totalBytes?: number;
  /** 0 to 1; absent until meaningful. */
  readonly progress?: number;
  /** Bytes a second. */
  readonly downloadRate: number;
  /** Bytes a second. */
  readonly uploadRate: number;
  /** Peers connected now. */
  readonly peers: number;
  readonly seeds: number;
  readonly leeches: number;
  readonly etaSeconds?: number;
  /** Bytes a second; 0 when the torrent has no limit of its own. */
  readonly downloadLimit: number;
  /** Bytes a second; 0 when the torrent has no limit of its own. */
  readonly uploadLimit: number;
  /** Whether the torrent forbids finding peers outside its trackers; absent when the client cannot tell. */
  readonly private?: boolean;
  /** The client's own words for what went wrong, when `state` is `error`. */
  readonly error?: string;
}

/** One file inside a torrent. */
export interface TorrentClientFile {
  /** Position in the torrent's file list, stable for the torrent's life. */
  readonly index: number;
  /** Path inside the torrent, `/`-separated, never a path on the client's disk. */
  readonly path: string;
  readonly size: number;
  readonly downloadedBytes: number;
  /** False when the client was told to skip the file. */
  readonly selected: boolean;
  /** -1 low, 0 normal, 1 high. */
  readonly priority: number;
}

/** What to hand a torrent client: a magnet link, or the bytes of a `.torrent` file. */
export type TorrentClientSource = { readonly kind: 'magnet'; readonly magnet: string } | { readonly kind: 'metainfo'; readonly bytes: Uint8Array };

/** Per-torrent speed limits in bytes a second; 0 removes the torrent's own limit. */
export interface TorrentClientLimits {
  readonly downloadLimit?: number;
  readonly uploadLimit?: number;
}

/** A torrent client driven through its own API: Transmission, uTorrent. */
export interface TorrentClient {
  probe(): Promise<ClientProbe>;
  /** Adds a torrent, or finds the one already there; resolves with its info hash either way. */
  add(source: TorrentClientSource, options?: { readonly paused?: boolean }): Promise<{ readonly infoHash: string }>;
  list(): Promise<readonly TorrentClientJob[]>;
  /** Resolves undefined when the client has no such torrent. */
  get(infoHash: string): Promise<TorrentClientJob | undefined>;
  /** Empty until the client has the torrent's metadata. */
  files(infoHash: string): Promise<readonly TorrentClientFile[]>;
  /** Marks the listed files wanted or skipped, and optionally sets their priority (-1, 0, 1). */
  selectFiles(infoHash: string, indexes: readonly number[], change: { readonly selected?: boolean; readonly priority?: number }): Promise<void>;
  pause(infoHash: string): Promise<void>;
  resume(infoHash: string): Promise<void>;
  remove(infoHash: string, deleteData: boolean): Promise<void>;
  setLimits(infoHash: string, limits: TorrentClientLimits): Promise<void>;
}

/** An NZB job's phase, as NAP-NZB names it. */
export type NzbClientState = 'queued' | 'downloading' | 'paused' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'skipped' | 'unknown';

/** What can be asked of one NZB job, as NAP-NZB names it. */
export type NzbClientAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'forget' | 'delete';

/** Optional fields of a submission an adapter can honour. */
export type NzbClientAddOption = 'categoryId' | 'priority' | 'startPaused' | 'password';

/** One NZB job as the downloader reports it, queue and history merged. */
export interface NzbClientJob {
  /** The downloader's own id for the job, as text; stable while the downloader keeps the job. */
  readonly id: string;
  readonly name: string;
  readonly state: NzbClientState;
  /** The job's own download hold, when the downloader reports one. */
  readonly paused?: boolean;
  /** 0 to 1, transfer only. */
  readonly progress?: number;
  readonly downloadedBytes?: number;
  readonly totalBytes?: number;
  /** Bytes a second for this job alone; absent when only a global rate is known. */
  readonly downloadRate?: number;
  /** A short word for what the downloader is doing, such as "Unpacking". */
  readonly stage?: string;
  /** The downloader's explanation, with no path, address or secret in it. */
  readonly message?: string;
  /** The downloader's category name, when the job has one. */
  readonly category?: string;
  /** What this adapter can do to the job in its present phase. */
  readonly actions: readonly NzbClientAction[];
}

/** A category the downloader is configured with. */
export interface NzbClientCategory {
  /** The downloader's own name for the category. */
  readonly name: string;
}

/** One NZB document handed to a downloader. */
export interface NzbClientAdd {
  /** The NZB XML, already validated and bounded by the caller. */
  readonly bytes: Uint8Array;
  /** Display name; the adapter makes it a safe file name. */
  readonly name: string;
  readonly category?: string;
  readonly priority?: 'low' | 'normal' | 'high';
  readonly paused?: boolean;
  /** Archive password. */
  readonly password?: string;
}

/** An NZB downloader driven through its own API: NZBGet, SABnzbd. */
export interface NzbClient {
  /** Actions this adapter can carry out for at least some jobs. */
  readonly actions: readonly NzbClientAction[];
  /** Submission fields this adapter honours. */
  readonly addOptions: readonly NzbClientAddOption[];
  probe(): Promise<ClientProbe>;
  categories(): Promise<readonly NzbClientCategory[]>;
  /** Submits the document; rejects `unavailable:rejected` when the downloader declines without creating a job. */
  add(request: NzbClientAdd): Promise<{ readonly id: string }>;
  /** Every job the downloader shows, in its queue or its history, each once. */
  list(): Promise<readonly NzbClientJob[]>;
  /** Resolves undefined when the downloader has no such job in queue or history. */
  get(id: string): Promise<NzbClientJob | undefined>;
  /** Applies one action to one job; resolves with the job's id afterwards, which differs when a retry made a successor. */
  control(id: string, action: NzbClientAction): Promise<{ readonly id: string }>;
}

/** A file a Soulseek peer offers. */
export interface SoulseekClientFile {
  readonly username: string;
  /** The peer's own virtual path, kept as sent. */
  readonly path: string;
  /** Advertised size in bytes, as canonical unsigned decimal text. */
  readonly size: string;
  readonly locked: boolean;
  readonly extension?: string;
  readonly bitrateKbps?: number;
  readonly durationSeconds?: number;
  readonly sampleRateHz?: number;
  readonly bitDepth?: number;
}

/** Why a Soulseek transfer or listing failed, as NAP-SOULSEEK names it. */
export type SoulseekClientFailure = 'peer_unavailable' | 'peer_denied' | 'timeout' | 'limit_exceeded' | 'backend_error';

/** A transfer's phase, as the daemon reports it. */
export type SoulseekClientTransferState = 'queued' | 'transferring' | 'complete' | 'cancelled' | 'failed';

/** One download as the daemon reports it. */
export interface SoulseekClientTransfer {
  /** The daemon's own id for the transfer. */
  readonly id: string;
  readonly username: string;
  readonly path: string;
  /** Size in bytes the daemon reports for the transfer, as canonical unsigned decimal text. */
  readonly size: string;
  readonly state: SoulseekClientTransferState;
  /** Bytes received so far, as canonical unsigned decimal text. */
  readonly received: string;
  readonly queuePosition?: number;
  readonly bytesPerSecond?: number;
  /** Present exactly when `state` is `failed`. */
  readonly failure?: SoulseekClientFailure;
  /** The daemon's words for the failure, with no address or path on its disk. */
  readonly message?: string;
}

/** What a search has gathered so far. */
export interface SoulseekClientSearch {
  /** True once the daemon has stopped collecting. */
  readonly complete: boolean;
  /** Every file gathered so far, in the order the daemon lists them. */
  readonly files: readonly SoulseekClientFile[];
}

/** A Soulseek daemon driven through its own API: slskd. */
export interface SoulseekClient {
  probe(): Promise<ClientProbe>;
  /** Whether the daemon is signed in to the network now. */
  state(): Promise<'offline' | 'online'>;
  /** Starts a search; `username` narrows it to one peer. Resolves with the daemon's id for it. */
  startSearch(text: string, options: { readonly username?: string; readonly timeoutMs: number; readonly limit: number }): Promise<{ readonly id: string }>;
  searchResults(id: string): Promise<SoulseekClientSearch>;
  /** Stops collecting; results gathered so far stay readable. */
  stopSearch(id: string): Promise<void>;
  /** Forgets the search in the daemon. */
  deleteSearch(id: string): Promise<void>;
  /** A peer's whole shared listing, flattened. Rejects `unavailable:peer-unavailable` or `denied:peer`. */
  browse(username: string): Promise<readonly SoulseekClientFile[]>;
  /** Queues one file from one peer. */
  download(file: Pick<SoulseekClientFile, 'username' | 'path' | 'size'>): Promise<{ readonly id: string }>;
  /** Resolves undefined when the daemon has no such transfer. */
  transfer(username: string, id: string): Promise<SoulseekClientTransfer | undefined>;
  /** Stops a transfer; with `remove`, also forgets its record in the daemon. */
  cancel(username: string, id: string, remove: boolean): Promise<void>;
}

/** The fields of a `.torrent` file kernl reads before handing it on. */
export interface TorrentMetainfo {
  /** Lowercase 40-character hexadecimal SHA-1 of the bencoded `info` dictionary, exactly as it appears in the file. */
  readonly infoHash: string;
  readonly name: string;
  readonly private: boolean;
  readonly totalBytes: number;
  /** `/`-separated paths inside the torrent. */
  readonly files: readonly { readonly path: string; readonly size: number }[];
  readonly trackers: readonly string[];
}
