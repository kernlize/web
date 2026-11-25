// What @kernlize/core adds over the kernel: its modules. Each entry re-exports the kernel itself, because esbuild drops
// an external `export *` from a chunk two entries share (D-068).

/**
 * The npm package name, shared by both registry builds.
 *
 * @example
 * ```ts
 * PACKAGE_NAME; // '@kernlize/core'
 * ```
 */
export const PACKAGE_NAME = '@kernlize/core';

export type { AppletCatalog } from './catalog/types.js';
export type { KernlMultiplayer } from './multiplayer/types.js';
export type { Kernl, KernlMembers, KernlModuleOptionKeys, KernlModuleOptions, KernlOptions, ModuleMembers } from './kernl-members.js';
export type { MessagingBackendFactories } from './messaging/backend-factories.js';
export {
  DEFAULT_MONITOR_RELAYS,
  DEFAULT_SUGGESTIONS,
  createRelayDirectory,
  type DirectoryPool,
  type RelayDirectory,
  type RelayDirectoryOptions,
  type RelayListing,
  type SuggestOptions,
  type SuggestPurpose,
} from './relays/directory.js';
export {
  createAccountMailboxes,
  mailboxTags,
  mailboxesFromEvent,
  type AccountMailboxes,
  type AccountMailboxesOptions,
  type MailboxPool,
  type MailboxSigner,
  type MailboxState,
  type Mailboxes,
} from './relays/mailboxes.js';
export {
  createColumnsLayout,
  createDefaultLayouts,
  createDwindleLayout,
  createLayoutRegistry,
  createMasterStackLayout,
  createWindowManager,
  floatingLayout,
  type LayoutChoice,
  type LayoutEntry,
  type LayoutOptions,
  type LayoutRegistry,
  type LayoutStrategy,
  type ManagedWindow,
  type MasterStackOptions,
  type Rect,
  type VisibilityTarget,
  type WindowManager,
  type WindowManagerOptions,
  type WindowManagerState,
  type WindowPlacement,
  type WindowSize,
  type WindowState,
} from './wm/index.js';
export {
  attachEventCache,
  createEventCache,
  createIndexedDbCacheAdapter,
  createMemoryCacheAdapter,
  createSqliteOpfsCacheAdapter,
  defaultWebCacheAdapters,
  fromEventDatabase,
  isCorruptionError,
  openEventCache,
  type AttachedEventCache,
  type AttachEventCacheOptions,
  type CacheRecoveryEvent,
  type EventCache,
  type EventCacheAdapter,
  type EventRecords,
  type FilenameStorage,
  type IndexedDbCacheOptions,
  type LockManagerLike,
  type OpenEventCacheOptions,
  type SqliteDriver,
  type SqliteFiles,
  type SqliteOpfsOptions,
  type SqlStatement,
  type SqlValue,
  connectEventCache,
  type ConnectedEventCache,
  type EventCacheOpener,
} from './cache/index.js';
export { createDefaultMessaging, createProviderMessaging, type DefaultMessagingOptions, type ProviderMessagingOptions, type RegisteredProvider } from './messaging/default-registry.js';
export { MESSAGING_UNAVAILABLE_REASONS, messagingSigner, signerAvailability, type MessagingEncryption } from './messaging/availability.js';
export type { SignerMessagingOptions } from './messaging/signer-backend.js';
export { createPrivateMessagesBackend } from './messaging/private-backend.js';
export { createLegacyMessagesBackend } from './messaging/legacy-backend.js';
export { createSealedGroupStore, type SealedGroupStoreOptions } from './messaging/group-storage.js';
export { createGroupNetwork } from './messaging/group-network.js';
export type { InboxRelays } from './messaging/inbox-relays.js';
export { createSealedRatchetStorage, type SealedRatchetStorageOptions } from './messaging/ratchet-storage.js';
export { createDefaultBridges, type DefaultBridgesOptions } from './bridges/default-registry.js';
export { labelConversations } from './messaging/label-conversations.js';
export { createAccountFileServers, DEFAULT_FILE_SERVERS, fileServersFromEvent, fileServerTags, type AccountFileServers, type AccountFileServersOptions, type FileServerState } from './files/file-servers.js';
export { askUploadConsent, createBlossomUploader, describeUpload, sizeWords, type BlossomUploaderOptions, type MultiServerUpload, type UploadDetails } from './files/uploader.js';
export { createCommonActions, type CommonActionsOptions, type ConsentedSigner, type SignerAndGate } from './social/common-actions.js';
export { directoryModule } from './modules/directory.js';
export { cacheModule } from './modules/cache.js';
export { profilesModule } from './modules/profiles.js';
export { peopleModule } from './modules/people.js';
export { mailboxesModule } from './modules/mailboxes.js';
export { filesModule } from './modules/files.js';
export { settingsModule } from './modules/settings.js';
export { catalogModule } from './modules/catalog.js';
export { keysModule } from './modules/keys.js';
export { intentsModule } from './modules/intents.js';
export { bridgesModule } from './modules/bridges.js';
export { downloadsModule } from './modules/downloads.js';
export { multiplayerModule, type MultiplayerModuleOptions } from './modules/multiplayer.js';
export { messagingModule, type MessagingModuleOptions } from './modules/messaging.js';
export { legacyDm, privateDm } from './messaging/providers.js';
export { messagingProviderModule, type MessagingProviderModule, type ProviderOptions, type ProviderParts } from './messaging/provider-module.js';
export { themeModule, type ThemeApi } from './modules/theme.js';
export { socialModule } from './modules/social.js';
export { commonActionsFor } from './social/network-actions.js';
export { createCvmRelayPool, createRemoteToolsService, mergeFamilies, type RemoteToolsOptions } from './multiplayer/remote-tools.js';
export { createWindowIdentities, type WindowIdentities } from './multiplayer/window-identities.js';
export { createShortcutsService, type ShortcutKey, type ShortcutSettings, type ShortcutsOptions, type ShortcutsService } from './keys/shortcuts.js';
export { createMultiplayerSettings, validFamily, type MultiplayerSettings, type MultiplayerState } from './multiplayer/settings.js';
export { discoverToolFamilies, TOOL_DISCOVERY_TIMEOUT_MS, type ToolDiscoveryOptions, type ToolFamilyCandidate } from './multiplayer/tool-discovery.js';
export { createDirectConnectionsService, describeDirectConnection, directNamespace, type DirectConnectionsOptions } from './multiplayer/direct-connections.js';
export { createDirectSignaling, DIRECT_MAX_PAYLOAD_BYTES, DIRECT_SIGNAL_KIND, DIRECT_SIGNALING_PROFILE, type DirectSignalingOptions, type SignalRelay, type SignalSigner } from './multiplayer/direct-signaling.js';
export { PERSON_HINT_TIMEOUT_MS, createPeople, parsePerson, type People, type PeopleOptions, type PersonPointer } from './people/person.js';
export { locateRecipients, locateSendRecipients } from './people/locate-recipients.js';
export { createProfiles, toProfileCard, type ProfileCard, type ProfileLoader, type ProfilePointer, type Profiles, type ProfilesOptions } from './profiles/profiles.js';
export { addressOf, newestEntries, toCatalogEntry, type CatalogEntry } from './catalog/entry.js';
export { CATALOG_EMIT_MS, CATALOG_LIMIT, CATALOG_SETTLE_MS, CATALOG_TIMEOUT_MS, catalogRelays, loadCatalog, streamCatalog, type LoadCatalogOptions } from './catalog/fetch.js';
export { fuzzyScore, popularTopics, searchCatalog, type CatalogQuery, type TopicCount } from './catalog/search.js';
export { createInstalledApplets, type InstallableApplet, type InstalledApplet, type InstalledApplets, type InstalledContract } from './intents/installed.js';
export {
  HANDLER_PREFERENCES_KIND,
  catalogIdForRef,
  parseHandlerPreferences,
  preferenceTemplate,
  preferredHandlers,
  refForCatalogId,
  type HandlerPreferences,
} from './intents/preferences.js';
export { createHandlerDefaults, preferenceRelays, type HandlerDefaults, type HandlerDefaultsOptions, type PreferenceSigner } from './intents/defaults.js';
export { createIntentRouter, type IntentRouter, type IntentRouterOptions } from './intents/router.js';
export { DELIVERY_RETRY, createIntentDelivery, type IntentDeliveryOptions } from './intents/delivery.js';
export { createKernlIntents, type KernlIntentDeps, type KernlIntents } from './kernl-intents.js';
export type { DownloadQuestion, DownloadQuestionLine, DownloadService, DownloadServiceDeps } from './downloads/types.js';
export { createDownloadClients, currentPageScheme, DOWNLOAD_PROGRAMS, type CheckedConnection, type ClientFor, type ConnectionChange, type ConnectionRouting, type DownloadClients, type DownloadClientsOptions, type DownloadClientsState, type DownloadConnection, type DownloadDomain, type DownloadProgram, type DownloadProgramInfo, type DownloadSignIn, type RoutedClient, type RoutedDomain } from './downloads/download-clients.js';
export { DOWNLOAD_BINDINGS, supportsDomainBindings, type BoundPreludeOptions, type DomainBinding, type DomainBindingMethod } from './downloads/bindings.js';
export { createTorrentService, type TorrentServiceOptions } from './downloads/torrent-service.js';
export { createNzbService, readNzbDocument, type NzbDocument, type NzbDownloader, type NzbServiceOptions } from './downloads/nzb-service.js';
export { createSoulseekService, DEFAULT_SOULSEEK_LIMITS, SOULSEEK_SESSION_QUESTION, type SoulseekLimits, type SoulseekServiceOptions } from './downloads/soulseek-service.js';
export { createKernlDownloads, describeDownloadQuestion, DOWNLOAD_DOMAINS, type KernlDownloads, type KernlDownloadsDeps } from './kernl-downloads.js';
