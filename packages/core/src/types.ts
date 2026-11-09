import type { Observable } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import type { RelayPool } from 'applesauce-relay';
import type { AccountManager, IAccount } from 'applesauce-accounts';
import type { ShellBridge, ShellEnvironment } from '@kehto/shell';
import type { Capability } from '@kehto/runtime';
import type { NappletArtifactCache, NappletManifest } from '@kehto/nip/5d';
import type { NostrEvent } from '@napplet/core';
import type { GuardConfig, GuardEvent, GuardProfile, MitigationDescription, WindowVisibility } from '@kernlize/guard';
import type { MessagingBackend, MessagingRegistry, ReplyAnswer, ReplyPrompt } from '@kernlize/messaging';
import type { BridgeRegistry, TorrentBackend } from '@kernlize/bridges';
import type { CatalogEntry } from './catalog/entry.js';
import type { Profiles } from './profiles/profiles.js';
import type { AccountMailboxes } from './relays/mailboxes.js';
import type { RelayDirectory } from './relays/directory.js';
import type { LoadCatalogOptions } from './catalog/fetch.js';
import type { HandlerDefaults } from './intents/defaults.js';
import type { InstalledApplet } from './intents/installed.js';


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
  readonly capabilities: readonly Capability[];
  readonly blocked: boolean;
  readonly stateQuotaBytes: number;
}

/** User-facing grant operations. Everything here is per applet identity and reversible. */
export interface Grants {
  list(): readonly GrantRecord[];
  get(identity: AppletIdentity): GrantRecord | undefined;
  /** Allow a domain for this applet; maps to the kehto capabilities that domain needs. */
  allowDomain(identity: AppletIdentity, domain: string): void;
  /** Withdraw a domain; live sessions lose it immediately. */
  revokeDomain(identity: AppletIdentity, domain: string): void;
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
  readonly severity: 'routine' | 'destructive';
  readonly lines: readonly ConsentLine[];
  readonly applet: AppletIdentity;
  /** The raw event, for an "advanced" disclosure. */
  readonly event: NostrEvent;
}

/** What the host must answer. */
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
  /** Show something the applet or the guard wants the user to know. */
  notify(notice: { readonly title: string; readonly body?: string; readonly windowId?: string; readonly tone: 'info' | 'warning' }): void;
  /** Open a link outside the shell after the link policy allowed it. */
  openLink(url: string): void;
  /** Current visibility for a window, when the core needs it synchronously. */
  getVisibility(windowId: string): WindowVisibility;
  /** Called after the core removed a frame because its binding was revoked. */
  onRevoked(windowId: string, reason: string): void;
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
  /** Verify an artifact blob. Defaults to `fetch` over the manifest's servers. */
  fetchBlob?(sha256: string, servers: readonly string[]): Promise<Uint8Array>;
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
  /** Theme pushed to applets that hold `theme:read`. */
  readonly theme?: Record<string, unknown>;
  /** Backends for the messaging providers; absent ones stay unavailable. */
  readonly messagingBackends?: MessagingBackendFactories;
  /** Opens the verified-artifact cache. Defaults to Cache Storage when the page has it, otherwise none. */
  readonly artifactCache?: () => Promise<NappletArtifactCache | undefined>;
  /** Applets that come with the host, opened by `kernl:<id>` without a lookup. */
  readonly builtins?: readonly BuiltinApplet[];
  /** How intent delivery waits for a target to come up; `DELIVERY_RETRY` by default. */
  readonly intentRetry?: { readonly intervalMs: number; readonly attempts: number };
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
  readonly grants: Grants;
  readonly relays: RelayTiers;
  readonly messaging: MessagingRegistry;
  readonly bridges: BridgeRegistry;
  readonly catalog: AppletCatalog;
  /** People's names and pictures, loaded from their profiles on demand. */
  readonly profiles: Profiles;
  /** The signed-in account's published inbox and outbox (NIP-65); the `outbox` tier follows its outboxes. */
  readonly mailboxes: AccountMailboxes;
  /** Monitored servers (NIP-66) for completing and suggesting; idle until `start()`. */
  readonly directory: RelayDirectory;
  readonly intents: Intents;
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
