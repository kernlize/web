import type { Observable } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import type { RelayPool } from 'applesauce-relay';
import type { AccountManager, IAccount } from 'applesauce-accounts';
import type { ShellBridge, ShellEnvironment } from '@kehto/shell';
import type { Capability } from '@kehto/runtime';
import type { PermissionRuleAction, PermissionRules } from '@kehto/firewall';
import type { CvmRegistryFamily } from '@kehto/services';
import type { MultiplayerSettings } from './multiplayer/settings.js';
import type { AppletMessage } from './applets/traffic.js';
import type { ToolFamilyCandidate } from './multiplayer/tool-discovery.js';
import type { NappletArtifactCache, NappletManifest } from '@kehto/nip/5d';
import type { NostrEvent } from '@napplet/core';
import type { GuardConfig, GuardEvent, GuardProfile, MitigationDescription, WindowVisibility } from '@kernlize/guard';
import type { MessagingBackend, MessagingRegistry, ReplyAnswer, ReplyPrompt } from '@kernlize/messaging';
import type { BridgeRegistry, ClientFetch, PageScheme, TorrentBackend } from '@kernlize/bridges';
import type { DownloadClients } from './downloads/download-clients.js';
import type { SecretsDescription, SecretsProvider } from './secrets/secrets.js';
import type { CatalogEntry } from './catalog/entry.js';
import type { KernlMedia } from './media/kernl-media.js';
import type { Profiles } from './profiles/profiles.js';
import type { People } from './people/person.js';
import type { EventCacheOpener } from './cache/connect.js';
import type { AccountMailboxes } from './relays/mailboxes.js';
import type { AccountFileServers } from './files/file-servers.js';
import type { SettingsPrompt } from './applets/applet-config.js';
import type { RelayDirectory } from './relays/directory.js';
import type { LoadCatalogOptions } from './catalog/fetch.js';
import type { HandlerDefaults } from './intents/defaults.js';
import type { InstalledApplet } from './intents/installed.js';
import type { ShortcutKey, ShortcutSettings } from './keys/shortcuts.js';
import type { AnyKernlModule } from './modules/module.js';


/** The two values an applet's grants are keyed on. Both come from verification, never from the applet. */
export interface AppletIdentity {
  readonly dTag: string;
  readonly hash: string;
}

/** The address a user typed or clicked. Decoded, never trusted beyond "which event to fetch". */
export type AppletPointer =
  | { readonly kind: 'address'; readonly pubkey: string; readonly identifier: string; readonly eventKind: number; readonly relays: readonly string[] }
  | { readonly kind: 'event'; readonly id: string; readonly relays: readonly string[]; readonly author?: string }
  | { readonly kind: 'builtin'; readonly id: string; readonly relays: readonly string[] };

/**
 * An applet the host ships with itself. No manifest is fetched for it: its bytes are pinned by hash in
 * the host's own code, which is the trust the shell already rests on. It runs sealed like any other applet.
 */
export interface BuiltinApplet {
  /** Lowercase name; the applet's address is `kernl:<id>` and its grants are keyed on it. */
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** SHA-256 of the artifact, in hex. Bytes that do not hash to it are refused. */
  readonly sha256: string;
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  /** Requests it takes from other applets, such as `napplet:dm/open`. */
  readonly archetypes?: readonly { readonly slug: string; readonly convention: string; readonly params?: readonly string[] }[];
  /** Domains switched on the first time it is opened; the user can withdraw each one afterwards. */
  readonly grants?: readonly string[];
  /** Load the single-file artifact. */
  load(): Promise<string>;
}

/** What the shell shows before the user agrees to run an applet. Derived from the verified manifest. */
export interface AppletSummary {
  readonly identity: AppletIdentity;
  /** A shareable address for the manifest (`naddr1…`, or `nevent1…` for a pinned version). */
  readonly address: string;
  readonly title: string;
  readonly description: string;
  readonly publisher: string;
  readonly icon?: { readonly sha256: string; readonly mimeType: string };
  /** Domains the applet says it needs. Advisory; never a grant. */
  readonly requires: readonly string[];
  /** Domains the applet can use when offered. Advisory; never a grant. */
  readonly optional: readonly string[];
  readonly archetypes: readonly string[];
  readonly source?: string;
  /** The applet came with the shell; nobody published it, so `publisher` names no one. */
  readonly builtin?: true;
  readonly manifest: NappletManifest;
}

/** Everything needed to put a verified applet on screen. Produced by `planMount`, consumed by `mountApplet`. */
export interface MountPlan {
  readonly windowId: string;
  readonly summary: AppletSummary;
  /** Verified bytes with the guard's CSP and the runtime prelude already inserted. */
  readonly srcdoc: string;
  /** Always `allow-scripts`. Present so the host cannot forget it. */
  readonly sandbox: 'allow-scripts';
  /** Domains and services this applet will see, after the user's grants narrowed them. */
  readonly environment: ShellEnvironment;
  /** Required domains the environment does not include. The host should warn before mounting. */
  readonly missingRequired: readonly string[];
}

/** Lifecycle of one mounted applet. */
/** A guard limit an applet crossed and was quarantined for. */
export interface AppletStopLimit {
  /** `flood`: too many messages inside the quarantine window. `hidden-resource`: too many web fetches while hidden. */
  readonly cause: 'flood' | 'hidden-resource';
  /** The limit itself, from the profile in force when the applet was stopped. */
  readonly count: number;
  /** The span `count` is measured over, in milliseconds; absent for `hidden-resource`. */
  readonly windowMs?: number;
  readonly profile: GuardProfile;
}

/** What is known about why an applet was stopped, beyond its reason code. */
export interface AppletStopDetails {
  /** kehto's own diagnostic line, for a reason kehto observed. Never carries a message payload. */
  readonly detail?: string;
  /** The guard limit crossed, for a quarantine. */
  readonly limit?: AppletStopLimit;
}

export type AppletStatus = 'mounting' | 'running' | 'revoked' | 'closed';

/** The structural subset of an iframe element `mountApplet` needs. Lets the core stay DOM-free in tests. */
export interface FrameLike {
  readonly contentWindow: Window | null;
  /** Not read: the mount replaces the `sandbox` attribute through `setAttribute`, whatever tokens it held. */
  sandbox?: unknown;
  srcdoc: string;
  addEventListener(type: 'load', listener: (event: Event) => void): void;
  removeEventListener(type: 'load', listener: (event: Event) => void): void;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

/** A running applet as the host sees it. */
export interface AppletHandle {
  readonly windowId: string;
  readonly summary: AppletSummary;
  readonly status$: Observable<AppletStatus>;
  readonly status: AppletStatus;
  /** Tell the guard whether the window is on screen and focused. Drives deferral and tightening. */
  setVisibility(visibility: WindowVisibility): void;
  /** Close the applet: revoke its binding, remove its frame, drop its queues. Idempotent. */
  close(): void;
}


/** One applet's standing with the user. */
export interface GrantRecord {
  readonly identity: AppletIdentity;
  readonly domains: readonly string[];
  /** Domains the person chose to keep beside messages, against the seal; only they can set it (D-060). */
  readonly unsafe: readonly string[];
  readonly capabilities: readonly Capability[];
  /** Domains allowed or baseline that are not in force, because the applet can read messages and the person did not keep them (D-046). */
  readonly withheld: readonly string[];
  readonly blocked: boolean;
  /** Some of this record was granted for now and is not stored; `forgetTemporary` puts the stored record back (D-060). */
  readonly temporary: boolean;
  readonly stateQuotaBytes: number;
}

/** How a grant is made. */
export interface GrantChoice {
  /** True keeps the domain beside messages, against the seal; false drops that exception and keeps the grant. Only the person's own action may set it. */
  readonly unsafe?: boolean;
  /** False grants for now only. Defaults to true. */
  readonly remember?: boolean;
}

/** User-facing grant operations. Everything here is per applet identity and reversible. */
export interface Grants {
  list(): readonly GrantRecord[];
  get(identity: AppletIdentity): GrantRecord | undefined;
  /**
   * Allow a domain for this applet; maps to the kehto capabilities that domain needs. `unsafe`
   * keeps it in force beside messages, which would otherwise withhold it (D-046, D-060). `remember: false`
   * grants it for now: in force, never stored, and gone at `forgetTemporary`.
   */
  allowDomain(identity: AppletIdentity, domain: string, options?: GrantChoice): void;
  /** Withdraw a domain, and the exception kept for it; live sessions lose it immediately. With `remember: false` only for now. */
  revokeDomain(identity: AppletIdentity, domain: string, options?: Pick<GrantChoice, 'remember'>): void;
  /** Drop what was granted or taken back for now; the stored record is back in force. Does nothing when there was none. */
  forgetTemporary(identity: AppletIdentity): void;
  block(identity: AppletIdentity): void;
  unblock(identity: AppletIdentity): void;
  setStateQuota(identity: AppletIdentity, bytes: number): void;
  /** Domains the shell can offer at all in the current configuration. */
  availableDomains(): readonly string[];
  /** Domains granted automatically to every applet. In kernl this is the read-only, no-network set. */
  baselineDomains(): readonly string[];
  readonly changes$: Observable<GrantRecord>;
}


/** One line of a change the user is asked to approve. */
export interface ConsentLine {
  readonly label: string;
  readonly before?: string;
  readonly after?: string;
}

/** A write described as what it changes, not as JSON. */
export interface ConsentSummary {
  readonly title: string;
  /**
   * `destructive` replaces or erases part of the record; `public` puts something where anyone can fetch it;
   * `direct` connects the person to someone else, who learns their network address. All three are asked about.
   */
  readonly severity: 'routine' | 'destructive' | 'public' | 'direct';
  readonly lines: readonly ConsentLine[];
  readonly applet: AppletIdentity;
  /** The raw event, for an "advanced" disclosure; absent when what is asked about is not an event. */
  readonly event?: NostrEvent;
}

/** What the host must answer. */
/** An answer the person can give to a firewall question. `allow-session` lasts while the applet stays open. */
export type FirewallChoice = 'allow-once' | 'allow-session' | 'allow-always' | 'deny';

/** The applet a firewall question or stored answer is about. */
export interface FirewallApplet {
  readonly title: string;
  /** The applet across its versions; firewall rules are keyed by it. */
  readonly catalogId: string;
  /** The exact code that asked; stored answers are tied to it. */
  readonly identity: AppletIdentity;
}

/** One thing an applet asked for, named by identifiers the host words. */
export interface FirewallRequest {
  /** `access` is the use of a whole domain; `resource` one named thing; `network` one server. */
  readonly kind: 'access' | 'resource' | 'network';
  readonly domain: string;
  /** The request, such as `link.open`; `access` for a whole domain. */
  readonly operation: string;
  /** What exactly: the link, the server's origin, or the domain. */
  readonly target: string;
}

/** What a firewall question shows. It carries no copy; the host words it. */
export interface FirewallSummary {
  /** `link` opens something outside the shell; `access` is an applet starting with a domain; `request` is anything else. */
  readonly kind: 'link' | 'access' | 'request';
  readonly applet: FirewallApplet;
  readonly requests: readonly FirewallRequest[];
  /** The answers open to the person, most generous last but for `deny`, which is always last. */
  readonly choices: readonly FirewallChoice[];
}

/** A firewall question waiting for the person. */
export interface FirewallPrompt {
  readonly summary: FirewallSummary;
  /** Aborts when the request is withdrawn: the applet closed, or the question went unanswered too long. */
  readonly signal: { readonly aborted: boolean; addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void; removeEventListener(type: 'abort', listener: () => void): void };
  /** Answer with one of `summary.choices`; `undefined` dismisses without storing anything. */
  resolve(choice: FirewallChoice | undefined): void;
}

/** An answer in force: one the person gave, or one a rule gave for a running applet. */
export interface FirewallDecision {
  readonly id: string;
  /** The applet's catalogue id and the exact code the answer is tied to. */
  readonly catalogId: string;
  readonly hash: string;
  readonly request: FirewallRequest;
  readonly effect: 'allow' | 'deny';
  /** `session` ends when the applet's window does; `always` is kept across visits. */
  readonly lifetime: 'session' | 'always';
  /** True when a rule gave the answer, not the person. */
  readonly byRule: boolean;
}

/** Which firewall rule to change: everything, one domain or one request, for every applet or for one. */
export interface FirewallRuleTarget {
  /** The applet's catalogue id, as in `summary.manifest.catalogId`; every applet when absent. */
  readonly applet?: string;
  /** A whole domain, such as `relay`. */
  readonly domain?: string;
  /** One kind of request, such as `link.open`. */
  readonly operation?: string;
}

/**
 * The firewall: what happens to a request no stored answer covers, and the answers in force (D-056).
 * Grants decide which domains an applet holds; the firewall decides, inside those, what goes ahead
 * without asking, what asks, and what is refused.
 */
export interface Firewall {
  /** The rules in force. A shell starts with everything allowed and links asking. */
  rules(): PermissionRules;
  readonly rules$: Observable<PermissionRules>;
  /**
   * Set one rule, or remove it with `undefined`. An applet running under an answer the new rules
   * no longer give is stopped. Throws `invalid:rule` for a malformed target.
   */
  setRule(target: FirewallRuleTarget, action: PermissionRuleAction | undefined): void;
  restoreDefaults(): void;
  /** False when the stored answers could not be read: every applet is refused until `forgetAll()` clears them. */
  readonly available: boolean;
  /** Answers in force, the person's and the rules'. */
  decisions(): readonly FirewallDecision[];
  /** Emits whenever an answer is given, used up or taken back. */
  readonly decisions$: Observable<readonly FirewallDecision[]>;
  /** Take one answer back; an applet running under it is stopped. False when the stored copy could not be removed. */
  forget(id: string): boolean;
  /** Take every answer back and stop every applet. False when the stored copy could not be removed. */
  forgetAll(): boolean;
}

export interface ConsentPrompt {
  readonly summary: ConsentSummary;
  resolve(allowed: boolean): void;
}


/** Relay tiers: the three kehto knows plus the applet catalogue. */
export type RelayTier = 'discovery' | 'apps' | 'outbox' | 'super';

export interface RelayTiers {
  get(): Readonly<Record<RelayTier, readonly string[]>>;
  add(tier: RelayTier, url: string): void;
  remove(tier: RelayTier, url: string): void;
  /** Replace a tier's relays at once; unchanged lists are not re-emitted. Throws `invalid:relay-url` for an entry that is not a websocket URL. */
  set(tier: RelayTier, urls: readonly string[]): void;
  readonly changes$: Observable<Readonly<Record<RelayTier, readonly string[]>>>;
}


export interface Session {
  readonly accountId: string;
  readonly pubkey: string;
  readonly label: string;
  /** The account cannot sign. Applets see the identity but writes are refused. */
  readonly readOnly: boolean;
}


/** Minimal synchronous key-value store. `localStorage` satisfies it; tests use a Map. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One installed applet the handler chooser offers. */
export interface HandlerOption {
  /** The runtime-assigned catalogue id. */
  readonly id: string;
  readonly title: string;
  readonly address: string;
  /** The user's published preferences name it for this request. */
  readonly preferred: boolean;
}

/** What the chooser asks: which applet should take a request one applet made of another. */
export interface HandlerPrompt {
  readonly archetype: string;
  readonly action: string;
  /** The stable convention identity, such as `napplet:profile/open`. */
  readonly convention: string;
  /** The asking applet's title. */
  readonly source: string;
  /** Installed applets that accept the convention, preferred first. Empty when none is installed. */
  readonly options: readonly HandlerOption[];
  /** A coordinate the asking applet recommended; untrusted, a suggestion only. */
  readonly recommended?: string;
}

/** The user's answer. The id may be an applet installed while the chooser was open. */
export interface HandlerChoice {
  readonly id: string;
  /** Make it the default for the archetype. */
  readonly remember: boolean;
}

/** Host hooks the core calls. Applets never reach these. */
export interface KernlHost {
  readonly storage: StorageLike;
  /** Ask the user. Resolve `false` on dismiss. The core never times this out. */
  presentConsent(prompt: ConsentPrompt): void;
  /** Show an applet's settings form. Without it applets cannot have settings, and the `config` domain is not offered (D-036). */
  presentSettings?(prompt: SettingsPrompt): void;
  /** Show something the applet or the guard wants the user to know. */
  notify(notice: { readonly title: string; readonly body?: string; readonly windowId?: string; readonly tone: 'info' | 'warning' }): void;
  /**
   * Open a link outside the shell. `approved` is set when the firewall already let this exact link
   * through, by asking the person or by a rule they set, so the host should not ask again.
   */
  openLink(url: string, options?: { readonly approved?: boolean }): void;
  /** Current visibility for a window, when the core needs it synchronously. */
  getVisibility(windowId: string): WindowVisibility;
  /**
   * Called after the core removed a frame because its binding was revoked. `reason` is a stable
   * code: one of kehto's revocation reasons, or kernl's own (`quarantine`, `host`, `grant-narrowed`,
   * `blocked`, `firewall`). `details` carries what else is known about the stop.
   */
  onRevoked(windowId: string, reason: string, details?: AppletStopDetails): void;
  /**
   * Ask the user which applet should take a request. Resolve `undefined` on
   * dismiss. Without it, requests with several handlers and no default are refused.
   */
  chooseHandler?(prompt: HandlerPrompt): Promise<HandlerChoice | undefined>;
  /** Open the applet at an address, under its existing grants; resolve its window id, or undefined when it did not open. */
  openApplet?(address: string): Promise<string | undefined>;
  /** Bring a running applet's window to the front. */
  focusApplet?(windowId: string): void;
  /**
   * Ask the user which provider a reply should leave through when the person it is for last wrote
   * through another one. Resolve `undefined` on dismiss, which stops the send. Without it the
   * provider the user's order picked is used.
   */
  chooseReply?(prompt: ReplyPrompt): Promise<ReplyAnswer | undefined>;
  /**
   * Put a firewall question to the person: a request a rule says to ask about, such as opening a link.
   * Close the prompt when `signal` aborts. Without it, such a request is refused (D-056).
   */
  presentApproval?(prompt: FirewallPrompt): void;
  /** Verify an artifact blob. Defaults to `fetch` over the manifest's servers. */
  fetchBlob?(sha256: string, servers: readonly string[]): Promise<Uint8Array>;
  /**
   * Take a key pressed inside an applet that the applet has no shortcut for. Without it the
   * shell's own shortcuts do nothing while an applet has focus (D-054).
   */
  onShortcut?(key: ShortcutKey): void;
  now?(): number;
}


/**
 * Backend constructors for the three messaging providers. A provider whose
 * constructor is absent reports itself unavailable with a stable reason.
 */
export interface MessagingBackendFactories {
  readonly private?: () => MessagingBackend;
  readonly legacy?: () => MessagingBackend;
  readonly ratchet?: () => MessagingBackend;
  readonly group?: () => MessagingBackend;
}

export interface KernlOptions {
  readonly host: KernlHost;
  readonly relays?: Partial<Record<RelayTier, readonly string[]>>;
  readonly guard?: { readonly profile?: GuardProfile };
  /** Supplied by the app so it can register its own account types first. */
  readonly accounts?: AccountManager;
  readonly eventStore?: EventStore;
  readonly pool?: RelayPool;
  readonly messaging?: MessagingRegistry;
  readonly bridges?: BridgeRegistry;
  /**
   * The engine for magnet links when `bridges` is not given. With one, magnet links download
   * inside kernl instead of handing off to an app on the device (D-017).
   */
  readonly torrent?: TorrentBackend;
  /** Theme pushed to applets that hold `theme:read`. Read only when `modules` is left out; otherwise pass it to `themeModule`. */
  readonly theme?: Record<string, unknown>;
  /** Backends for the messaging providers; absent ones stay unavailable. */
  readonly messagingBackends?: MessagingBackendFactories;
  /** Opens the verified-artifact cache. Defaults to Cache Storage when the page has it, otherwise none. */
  readonly artifactCache?: () => Promise<NappletArtifactCache | undefined>;
  /** Opens the event cache, such as `() => openEventCache(defaultWebCacheAdapters())` from `@kernlize/core/cache`. Without one the shell keeps events in memory only (D-030). Read only when `modules` is left out; otherwise pass it to `cacheModule`. */
  readonly eventCache?: EventCacheOpener;
  /**
   * The opinions this shell loads (D-061). `kernlModules()` by default; a module left out is not
   * offered to applets. Fixed once the shell is composed, because the firewall admits an applet's
   * domains before its code runs (D-056).
   */
  readonly modules?: readonly AnyKernlModule[];
  /** Applets that come with the host, opened by `kernl:<id>` without a lookup. */
  readonly builtins?: readonly BuiltinApplet[];
  /** How intent delivery waits for a target to come up; `DELIVERY_RETRY` by default. */
  readonly intentRetry?: { readonly intervalMs: number; readonly attempts: number };
  /** Where applets' remote tools are looked for, and which tool families the host vouches for (D-041). */
  readonly remoteTools?: RemoteToolsSettings;
  /** How applets connect people directly: the relays that introduce them and the ICE servers that help (D-042). */
  readonly directConnections?: DirectConnectionsSettings;
  /** How the shell reaches the person's download programs, and whether their domains are offered (D-050). */
  readonly downloads?: DownloadsOptions;
  /** Where the shell keeps passwords and keys of services it signs in to; the host's storage, as typed, by default (D-052). */
  readonly secrets?: SecretsProvider;
  /** The chords the shell keeps from applets' keyboard shortcuts, and where key presses are heard (D-054). Read only when `modules` is left out; otherwise pass them to `keysModule`. */
  readonly shortcuts?: ShortcutSettings;
}

/** The host's settings for the `torrent`, `nzb` and `soulseek` domains. */
export interface DownloadsOptions {
  /** How the page running the shell was loaded; read from `location` by default, `http` where there is none. */
  readonly pageScheme?: () => PageScheme;
  /** `fetch` for every download program; the global one by default. */
  readonly fetch?: ClientFetch;
  /**
   * Whether the three domains are offered to applets. By default they are offered exactly when
   * the installed `@kehto/shell` can bind a domain it does not build in; a host whose own
   * prelude binds them says `true`.
   */
  readonly offer?: boolean;
}

/** A STUN or TURN server, as `RTCPeerConnection` takes it. Its credentials stay in the shell. */
export interface DirectIceServer {
  readonly urls: readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

/** The host's settings for direct connections between people. */
export interface DirectConnectionsSettings {
  /** Relays people in a room find each other through; the general (`super`) tier by default. */
  readonly relays?: readonly string[];
  /** STUN and TURN servers; none by default, so only people who can reach each other's devices connect. */
  readonly iceServers?: readonly DirectIceServer[];
  /** Makes a peer connection; the browser's `RTCPeerConnection` by default. Without either, the `webrtc` domain is not offered. */
  readonly createPeer?: (configuration: RTCConfiguration) => RTCPeerConnection;
}

/** The person's settings for meeting people and calling remote tools, kept on this device, and the search for tool families. */
export interface KernlMultiplayer extends MultiplayerSettings {
  /** Find tool families from an announcement reference, a schema hash or a website, over the servers in use (D-043). */
  discover(input: string): Promise<readonly ToolFamilyCandidate[]>;
}

/** The host's settings for remote tools. */
export interface RemoteToolsSettings {
  /** Relays a tool server is looked for on when the applet names none; the general (`super`) tier by default. */
  readonly relays?: readonly string[];
  /** Tool families pinned to verified schemas, for applets that ask by family; none by default. */
  readonly registry?: readonly CvmRegistryFamily[];
}

/** The applet store's catalogue. */
export interface AppletCatalog {
  /** List the applets published to the store's relays, newest first, once every relay has finished. */
  load(options?: LoadCatalogOptions): Promise<readonly CatalogEntry[]>;
  /** The same list, emitted again as manifests arrive; completes when every relay has finished. */
  stream(options?: LoadCatalogOptions): Observable<readonly CatalogEntry[]>;
}

/** Applets handing work to each other: what is installed, and which applet the user prefers for what. */
export interface Intents {
  /** Replays the installed list to new subscribers. */
  readonly installed$: Observable<readonly InstalledApplet[]>;
  installed(): readonly InstalledApplet[];
  /** Forget an applet; other applets can no longer hand work to it. */
  uninstall(catalogId: string): void;
  /** Record an applet as installed, so others can hand it work; the shell does it for every applet it plans. */
  record(summary: AppletSummary): InstalledApplet;
  readonly defaults: HandlerDefaults;
}

/** The guard as the UI sees it. */
export interface GuardFacade {
  readonly config: GuardConfig;
  readonly profile$: Observable<GuardProfile>;
  setProfile(profile: GuardProfile): void;
  readonly events$: Observable<GuardEvent>;
  mitigations(): readonly MitigationDescription[];
  /** Lift quarantine for a window after the user chose to. */
  release(windowId: string): void;
}

/** The composed shell. One per page. */
export interface Kernl {
  readonly accounts: AccountManager;
  readonly eventStore: EventStore;
  readonly pool: RelayPool;
  readonly bridge: ShellBridge;
  readonly guard: GuardFacade;
  /**
   * Every message between this shell's applets and itself, both ways, on the window and on the
   * port. Envelopes can hold private messages and signed events: a host keeps them in memory only.
   */
  readonly traffic$: Observable<AppletMessage>;
  readonly grants: Grants;
  readonly relays: RelayTiers;
  readonly messaging: MessagingRegistry;
  readonly bridges: BridgeRegistry;
  readonly catalog: AppletCatalog;
  /** People's names and pictures, loaded from their profiles on demand. */
  readonly profiles: Profiles;
  /** Finds a person from hex, `npub` or `nprofile`, asking the servers an `nprofile` names. */
  readonly people: People;
  /** The signed-in account's published inbox and outbox (NIP-65); the `outbox` tier follows its outboxes. */
  readonly mailboxes: AccountMailboxes;
  /** Where the account's uploads go (BUD-03, kind 10063); the defaults while it has no list. */
  readonly files: AccountFileServers;
  /** The person's servers, helpers and trusted tool families for meeting people and calling remote tools (D-043). */
  readonly multiplayer: KernlMultiplayer;
  /** The download programs the person set up on this device, and the check an address goes through before it is kept (D-050). */
  readonly downloads: DownloadClients;
  /** How the shell's secrets are kept, so a settings screen can say so (D-052). */
  readonly secrets: SecretsDescription;
  /** Monitored servers (NIP-66) for completing and suggesting; idle until `start()`. */
  readonly directory: RelayDirectory;
  readonly intents: Intents;
  /** The rules for what applets may ask for without the person being asked, and the answers in force. */
  readonly firewall: Firewall;
  /** Media applets play through the shell, and the person's media settings (D-063). */
  readonly media: KernlMedia;
  readonly session$: Observable<Session | null>;
  readonly session: Session | null;
  login(account: IAccount): Promise<Session>;
  logout(): Promise<void>;
  /** Decode an address or event pointer. Throws `invalid:pointer`. */
  decodePointer(input: string): AppletPointer;
  /** Fetch and verify the manifest and bytes. Throws `unavailable:` or `invalid:` reasons. */
  resolve(pointer: AppletPointer): Promise<AppletSummary>;
  /** Remember a verified applet so other applets can hand it work, without opening it. Throws `invalid:unresolved` for a summary this shell did not verify. */
  install(summary: AppletSummary): InstalledApplet;
  /** Build the mount plan for a verified applet under the user's current grants. */
  plan(summary: AppletSummary): Promise<MountPlan>;
  /** Put the applet in the frame. Performs the mount order and tracks the handle. */
  mount(plan: MountPlan, frame: FrameLike): AppletHandle;
  applets(): readonly AppletHandle[];
  /** Forward a `message` event from the window. The host wires this once. */
  handleWindowMessage(event: MessageEvent): void;
  destroy(): void;
}

/**
 * The members of the shell that modules provide, named by module id. Each is present when its
 * module is loaded, as it is with `kernlModules()` (D-062).
 */
export type ModuleMembers = 'directory' | 'profiles' | 'people' | 'mailboxes' | 'files' | 'catalog' | 'intents';

/**
 * The shell without the members modules provide: what `createKernl` returns, with each loaded
 * module's api beside it, when the host names its own modules. `Kernl` is this with kernl's own.
 */
export type Kernel = Omit<Kernl, ModuleMembers>;
