import type { MessagingRegistry } from '@kernlize/messaging';
import type { BridgeRegistry, TorrentBackend } from '@kernlize/bridges';
import type { DownloadClients, Profiles, People, AccountMailboxes, AccountFileServers, RelayDirectory, EventCacheOpener, ShortcutSettings, AppletCatalog, KernlMultiplayer } from '@kernlize/modules';
import type { AnyKernlModule, DirectConnectionsSettings, DownloadsOptions, Intents, Kernel, KernelBaseOptions, RemoteToolsSettings } from '@kernlize/kernel';

/** The members of the shell that kernl's own modules provide, by module id (D-062). Each is present when its module is loaded. */
export interface KernlMembers {
  /** The person's messaging providers, their order and their reply rule (D-016, D-018). */
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
  /** Monitored servers (NIP-66) for completing and suggesting; idle until `start()`. */
  readonly directory: RelayDirectory;
  readonly intents: Intents;
}

/** The ids of the members modules provide. */
export type ModuleMembers = keyof KernlMembers;

/** The composed shell with kernl's own modules: the kernel and every member they provide. One per page. */
export type Kernl = Kernel & KernlMembers;

/** The options `createKernl` reads only to build kernl's own modules when the host names none. */
export interface KernlModuleOptions {
  /** A messaging registry the host built, used as is and left open when the shell closes. Read only when `modules` is left out; otherwise pass it to `messagingModule({ registry })`. */
  readonly messaging?: MessagingRegistry;
  readonly bridges?: BridgeRegistry;
  /**
   * The engine for magnet links when `bridges` is not given. With one, magnet links download
   * inside kernl instead of handing off to an app on the device (D-017).
   */
  readonly torrent?: TorrentBackend;
  /** Theme pushed to applets that hold `theme:read`. Read only when `modules` is left out; otherwise pass it to `themeModule`. */
  readonly theme?: Record<string, unknown>;
  /** Opens the event cache, such as `() => openEventCache(defaultWebCacheAdapters())` from `@kernlize/core/cache`. Without one the shell keeps events in memory only (D-030). Read only when `modules` is left out; otherwise pass it to `cacheModule`. */
  readonly eventCache?: EventCacheOpener;
  /** How intent delivery waits for a target to come up; `DELIVERY_RETRY` by default. */
  readonly intentRetry?: { readonly intervalMs: number; readonly attempts: number };
  /** Where applets' remote tools are looked for, and which tool families the host vouches for (D-041). */
  readonly remoteTools?: RemoteToolsSettings;
  /** How applets connect people directly: the relays that introduce them and the ICE servers that help (D-042). */
  readonly directConnections?: DirectConnectionsSettings;
  /** How the shell reaches the person's download programs, and whether their domains are offered (D-050). */
  readonly downloads?: DownloadsOptions;
  /** The chords the shell keeps from applets' keyboard shortcuts, and where key presses are heard (D-054). Read only when `modules` is left out; otherwise pass them to `keysModule`. */
  readonly shortcuts?: ShortcutSettings;
}

/** The options `createKernl` reads only to build kernl's own modules. */
export type KernlModuleOptionKeys = keyof KernlModuleOptions;

/** What `createKernl` takes: the kernel's options, kernl's modules' options, and optionally the host's own module list. */
export type KernlOptions = KernelBaseOptions & KernlModuleOptions & {
  /**
   * The opinions this shell loads (D-061). `kernlModules()` by default; a module left out is not
   * offered to applets. Fixed once the shell is composed, because the firewall admits an applet's
   * domains before its code runs (D-056).
   */
  readonly modules?: readonly AnyKernlModule[];
};
