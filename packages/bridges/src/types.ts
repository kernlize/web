/** A protocol-specific address kernl can resolve on the user's behalf. */
export interface Locator {
  /** Lowercase scheme without the colon: `https`, `magnet`, `nzb`, `slsk`, `mailto`. */
  readonly scheme: string;
  /** The original string. */
  readonly raw: string;
  /** Scheme-specific fields, for example a magnet's info hash and display name. */
  readonly fields: Readonly<Record<string, string | readonly string[]>>;
}

/** Why a bridge cannot serve right now. */
export type BridgeAvailability =
  /** `handoff` is true when resolving opens an app on the user's device instead of kernl doing the transfer. */
  | { readonly available: true; readonly handoff?: true }
  | { readonly available: false; readonly reason: string };

/** What a bridge produced. Bytes for downloads, a handle for long-running jobs, a conversation for mail. */
export type BridgeResult =
  | { readonly kind: 'bytes'; readonly response: Response }
  | { readonly kind: 'job'; readonly id: string; readonly label: string }
  | { readonly kind: 'conversation'; readonly id: string; readonly participants: readonly string[] };

/** Per-request context the shell supplies. */
export interface BridgeContext {
  /** Verified applet identity that asked, or `shell` for the user's own request. */
  readonly requester: { readonly dTag: string; readonly hash: string } | 'shell';
  readonly signal?: AbortSignal;
  readonly headers?: Readonly<Record<string, string>>;
}

/** How a bridge moves data, described for the user. */
export interface BridgeExposure {
  /** The remote party learns the user's network address. */
  readonly revealsAddress: boolean;
  /** The transfer is encrypted in transit. */
  readonly encryptedInTransit: boolean;
  /** Other participants can see what the user is fetching. */
  readonly publicActivity: boolean;
}

/** A shell-owned service that resolves locators of certain schemes. */
export interface Bridge {
  /** Stable identifier (`http`, `torrent`, `nzb`, `soulseek`, `mail`). */
  readonly id: string;
  /** User-facing label named by function (`downloads`, `mail`). */
  readonly label: string;
  readonly schemes: readonly string[];
  readonly exposure: BridgeExposure;
  availability(): BridgeAvailability;
  resolve(locator: Locator, context: BridgeContext): Promise<BridgeResult>;
}

/** Consent hook the shell wires in front of every resolution. */
export type BridgeAuthorizer = (locator: Locator, bridge: Bridge, context: BridgeContext) => boolean | Promise<boolean>;

/** The registry the shell holds. */
export interface BridgeRegistry {
  register(bridge: Bridge): void;
  list(): readonly Bridge[];
  /** The bridge that serves a scheme, or undefined. */
  forScheme(scheme: string): Bridge | undefined;
  /** Parse, route, authorise and resolve. Rejects with `denied:`, `unavailable:` or `invalid:` reasons. */
  resolve(uri: string, context: BridgeContext): Promise<BridgeResult>;
}

/** Limits the HTTP bridge enforces. */
export interface HttpPolicy {
  readonly allowedSchemes: readonly string[];
  readonly maxRedirects: number;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  /** Hostnames that may be fetched even when they resolve privately; empty by default. */
  readonly allowPrivateHosts: readonly string[];
}

/** Traits every backend may declare. */
export interface BackendTraits {
  /**
   * True when the backend hands the locator to an app on the user's device rather than
   * moving data itself. kernl then makes no connection for the resolution. Read on every
   * availability check, so a backend that lets the user choose may switch it.
   */
  readonly handoff?: true | undefined;
}

/** A backend that can download torrents. */
export interface TorrentBackend extends BackendTraits {
  add(infoHash: string, trackers: readonly string[], context: BridgeContext, name?: string): Promise<{ id: string; name: string }>;
}

/** A backend that can fetch and process NZB jobs. */
export interface NzbBackend extends BackendTraits {
  add(url: string, context: BridgeContext): Promise<{ id: string; name: string }>;
}

/** A backend that can request a file from a Soulseek peer. */
export interface SoulseekBackend extends BackendTraits {
  download(user: string, path: string, context: BridgeContext): Promise<{ id: string; name: string }>;
}

/** A backend that can open or create a mail conversation. */
export interface MailBackend extends BackendTraits {
  open(address: string, subject: string | undefined, context: BridgeContext, body?: string): Promise<{ id: string }>;
}
