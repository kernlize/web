/**
 * Opinionated shell composition over kehto and applesauce: adapters, applet
 * resolution and mounting, grants, consent summaries, layouts and persistence.
 *
 * @packageDocumentation
 */
import { renderNappletFramePolicyMeta } from '@kehto/shell';

/**
 * The npm package name, shared by both registry builds.
 *
 * @example
 * ```ts
 * PACKAGE_NAME; // '@kernlize/core'
 * ```
 */
export const PACKAGE_NAME = '@kernlize/core';

/**
 * The `<meta>` element the host page puts in its `<head>` so applet frames can
 * never navigate away from their verified `srcdoc`. Rendered once by kehto.
 *
 * @example
 * ```ts
 * document.head.insertAdjacentHTML('afterbegin', KERNL_FRAME_POLICY_META);
 * ```
 */
export const KERNL_FRAME_POLICY_META: string = renderNappletFramePolicyMeta();

export type * from './types.js';

export { createNamespacedStore, type NamespacedStore } from './persistence/store.js';
export { DEFAULT_RELAY_TIERS, createRelayTiers } from './relays/tiers.js';
export type { TierMap } from './relays/tiers.js';
export { describeOutcome, relayUrls, summarizePublish, toRelayUrl, type PublishAnswer, type PublishOutcome } from './relays/publish-outcome.js';
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
  SHELL_RELAY_OPTIONS,
  createRelayPoolHooks,
  createRelayPoolLike,
  selectRelayTier,
  subscribeWithEose,
  type ApplesaucePool,
  type EoseSubscription,
} from './applesauce/relay-hooks.js';
export { createAppletRelayBackend, createAppletRelayService, createDmRelayPool, createOutboxRelayPool, publishAccepted, type OutboxRelayPoolLike } from './applesauce/relay-backend.js';
export { createAuthHooks, isReadOnlyAccount, wrapAccountSigner } from './applesauce/auth-hooks.js';
export {
  createIdentityProviders,
  createReplaceableLoader,
  lookupRelaysOf,
  type IdentityProfile,
  type IdentityProviderOptions,
  type IdentityProviders,
  type RelayPermissions,
} from './applesauce/identity-providers.js';
export { MESSAGES_DOMAIN, MESSAGE_COMPANION_DOMAINS, capabilitiesInForce, domainsInForce, sealsApplet, withheldDomains } from './grants/message-isolation.js';
export { KernlAccountManager, PLAINTEXT_KEY_ACCOUNT_TYPES, createKernlAccounts } from './applesauce/accounts.js';
export { THROWAWAY_IDENTITY_TYPE, ThrowawayIdentity, createThrowawayIdentity } from './applesauce/throwaway.js';

export { decodePointer } from './applets/pointer.js';
export { BUILTIN_PUBLISHER, builtinAddress, resolveBuiltin } from './applets/builtin.js';
export {
  BLOB_TIMEOUT_MS,
  MANIFEST_TIMING,
  defaultFetchBlob,
  fetchManifestEvent,
  openDefaultArtifactCache,
  resolveApplet,
  summarize,
  type ManifestTiming,
  type PublishedPointer,
  type ResolveAppletOptions,
  type ResolvedApplet,
} from './applets/resolve.js';
export { planMount, resolveAppletEnvironment, type PlanMountOptions } from './applets/plan.js';
export { appletMessageFailure, createAppletTraffic, describeAppletMessage, type AppletMessage, type AppletMessageDirection, type AppletTraffic } from './applets/traffic.js';
export { CONTROLLER_DENY_POLICY, mountApplet, type MountDeps, type MountGuardHooks, type MountedApplet } from './applets/mount.js';

export {
  createGuardPipeline,
  type GuardPipeline,
  type GuardPipelineOptions,
  type PipelineDisposition,
  type WindowResolution,
} from './guard/pipeline.js';
export { createRuntimeRateLimiter, runtimeOpClass, toGuardEvent } from './guard/runtime-rate-limit.js';
export { FIREWALL_RULES_STORAGE_KEY, createFirewallRules, defaultFirewallRules, type FirewallRules } from './firewall/rules.js';
export { answerFor, describeApproval } from './firewall/describe.js';
export {
  FIREWALL_DECISIONS_STORAGE_KEY,
  FIREWALL_PROMPT_TIMEOUT_MS,
  createFirewallPermissions,
  permissionPrincipalFor,
  type FirewallPermissionsOptions,
} from './firewall/permissions.js';
export { MAX_UNMOUNTED_PLANS, createAppletAdmissions, type AdmissionRuntime, type AppletAdmissions } from './firewall/admission.js';
export { createFirewall, type FirewallOptions, type KernlFirewall } from './firewall/firewall.js';

export { BASELINE_DOMAINS, DOMAIN_CAPABILITIES, capabilitiesForDomain, capabilitiesForDomains } from './grants/domain-capabilities.js';
export { createEnvironmentResolver, createGrants, type GrantsOptions, type KernlGrants } from './grants/grants.js';

export { abbreviate, describeChange, isDestructiveKind } from './consent/describe-change.js';
export {
  CURRENT_VERSION_TIMEOUT_MS,
  UNKNOWN_CURRENT_VERSION,
  createConsentHandler,
  createSigningConsent,
  lookupReplaceable,
  type LookupBefore,
  type LookupReplaceableOptions,
  type ResolveAppletIdentity,
  type SigningConsent,
  type SigningConsentOptions,
  type SigningTemplate,
} from './consent/handler.js';

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
export { createFallbackSubtle, installCryptoFallback, randomUuidFallback, renderRandomUuidFallbackScript, type CryptoFallbackReport, type CryptoScope } from './crypto/index.js';
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

export { createDefaultMessaging, type DefaultMessagingOptions } from './messaging/default-registry.js';
export { MESSAGING_UNAVAILABLE_REASONS, messagingSigner, signerAvailability, type MessagingEncryption } from './messaging/availability.js';
export type { SignerMessagingOptions } from './messaging/signer-backend.js';
export { createPrivateMessagesBackend } from './messaging/private-backend.js';
export { createLegacyMessagesBackend } from './messaging/legacy-backend.js';
export { createRatchetMessagesBackend, type RatchetMessagingOptions } from './messaging/ratchet-backend.js';
export { createGroupMessagesBackend, type GroupMessagingOptions } from './messaging/group-backend.js';
export { createSealedGroupStore, type SealedGroupStoreOptions } from './messaging/group-storage.js';
export { createGroupNetwork } from './messaging/group-network.js';
export type { InboxRelays } from './messaging/inbox-relays.js';
export { createSealedRatchetStorage, type SealedRatchetStorageOptions } from './messaging/ratchet-storage.js';
export { createDefaultBridges, type DefaultBridgesOptions } from './bridges/default-registry.js';

export { labelConversations } from './messaging/label-conversations.js';
export { createAccountFileServers, DEFAULT_FILE_SERVERS, fileServersFromEvent, fileServerTags, type AccountFileServers, type AccountFileServersOptions, type FileServerState } from './files/file-servers.js';
export { askUploadConsent, createBlossomUploader, describeUpload, sizeWords, type BlossomUploaderOptions, type MultiServerUpload, type UploadDetails } from './files/uploader.js';
export { createAppletConfig, type AppletConfigOptions, type SettingsPrompt } from './applets/applet-config.js';
export { createCommonActions, type CommonActionsOptions } from './social/common-actions.js';
export { commonActionsFor, createKernlNetwork, type KernlNetwork, type KernlNetworkParts } from './kernl-network.js';
export { createCvmRelayPool, createRemoteToolsService, mergeFamilies, type RemoteToolsOptions } from './multiplayer/remote-tools.js';
export { createWindowIdentities, type WindowIdentities } from './multiplayer/window-identities.js';
export { KEY_REPEAT_WINDOW_MS, createForwardedKeys, type ForwardedKeys } from './keys/forwarded-keys.js';
export { createKeymapHold, type KeymapHold, type KeymapHoldOptions } from './keys/keymap-hold.js';
export { createShortcutsService, type ShortcutKey, type ShortcutSettings, type ShortcutsOptions, type ShortcutsService } from './keys/shortcuts.js';
export { createKernlMedia, type KernlMedia, type KernlMediaOptions, type MediaSessionView, type MediaUserCommand } from './media/kernl-media.js';
export { DEFAULT_MEDIA_SETTINGS, MEDIA_SETTING_CHOICES, MEDIA_SETTINGS_KEY, mediaSettingsFrom, readMediaSettings, writeMediaSettings, type MediaAutoplay, type MediaConcurrency, type MediaHiddenWindows, type MediaSettings, type MediaTakeover, type MediaVideoPlacement } from './media/settings.js';
export { createMultiplayerSettings, validFamily, type MultiplayerSettings, type MultiplayerState } from './multiplayer/settings.js';
export { discoverToolFamilies, TOOL_DISCOVERY_TIMEOUT_MS, type ToolDiscoveryOptions, type ToolFamilyCandidate } from './multiplayer/tool-discovery.js';
export { createDirectConnectionsService, describeDirectConnection, directNamespace, type DirectConnectionsOptions } from './multiplayer/direct-connections.js';
export { createDirectSignaling, DIRECT_MAX_PAYLOAD_BYTES, DIRECT_SIGNAL_KIND, DIRECT_SIGNALING_PROFILE, type DirectSignalingOptions, type SignalRelay, type SignalSigner } from './multiplayer/direct-signaling.js';
export { LINK_PROTOCOLS, acceptAnyRelay, createKernlServices, fetchThroughFirewall, isTheme, resourceErrorFor, resourceInitFor, shellRelayOrigins, type DirectConnectionsDeps, type KernlServiceDeps, type KernlServices } from './kernl-services.js';
export { createShellAdapter, type ShellAdapterDeps } from './kernl-adapter.js';
export { createAppletLifecycle, grantNarrowingReason, resolveWindow, type AppletLifecycle, type LifecycleContext } from './kernl-lifecycle.js';
export { createKernl, toSession } from './kernl.js';
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
export type { PlannedExtensions } from './applets/plan.js';
export { createMemorySecrets, createStorageSecrets, type SecretsDescription, type SecretsProvider } from './secrets/secrets.js';
