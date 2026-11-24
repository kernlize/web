/**
 * The kernel: the applesauce trio, the guard pipeline, the firewall, grants, signing consent,
 * secrets, the media player, applet resolve, plan and mount, the module host and the ask channel
 * (D-068). Every opinion is a module a host names; kernl's own list is `@kernlize/preset`.
 *
 * @packageDocumentation
 */
import { renderNappletFramePolicyMeta } from '@kehto/shell';

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
  loadReplaceableQuietly,
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
export { createFallbackSubtle, installCryptoFallback, randomUuidFallback, renderRandomUuidFallbackScript, type CryptoFallbackReport, type CryptoScope } from './crypto/index.js';
export { createAppletConfig, type AppletConfigOptions, type SettingsPrompt } from './applets/applet-config.js';
export type { AnyKernlModule, IntersectionOf, KernelContext, KernlModule, ModuleApiEntry, ModuleApis, ModuleIdentity, ModuleInstance, ReplaceablePointer } from './module-host/module.js';
export { ASK_KINDS, ASK_REFUSALS, type Ask, type AskAnswer, type AskKind, type AskKinds, type AskRenderer, type AskRenderers, type AskSignal } from './asks/kinds.js';
export { createAskChannel, toAskChannel, type AskChannel, type AskChannelOptions, type AskHost } from './asks/channel.js';
export { KERNEL_DOMAINS, MODULE_NATIVE_DOMAINS, checkModules, mergeExtensions, setupModules, type ComposedModules, type KernelContextParts } from './module-host/compose.js';
export { createKernlNetwork, type KernlNetwork, type KernlNetworkParts } from './kernl-network.js';
export { KEY_REPEAT_WINDOW_MS, createForwardedKeys, type ForwardedKeys } from './guard/forwarded-keys.js';
export { createKeymapHold, type KeymapHold, type KeymapHoldOptions } from './guard/keymap-hold.js';
export { createKernlMedia, type KernlMedia, type KernlMediaOptions, type MediaSessionView, type MediaUserCommand } from './media/kernl-media.js';
export { DEFAULT_MEDIA_SETTINGS, MEDIA_SETTING_CHOICES, MEDIA_SETTINGS_KEY, mediaSettingsFrom, readMediaSettings, writeMediaSettings, type MediaAppletClosed, type MediaAutoplay, type MediaConcurrency, type MediaHiddenWindows, type MediaSettings, type MediaTakeover, type MediaVideoPlacement } from './media/settings.js';
export { LINK_PROTOCOLS, acceptAnyRelay, createKernlServices, fetchThroughFirewall, isTheme, resourceErrorFor, resourceInitFor, shellRelayOrigins, type KernlServiceDeps, type KernlServices } from './kernl-services.js';
export { createShellAdapter, type ShellAdapterDeps } from './kernl-adapter.js';
export { createAppletLifecycle, grantNarrowingReason, resolveWindow, type AppletLifecycle, type LifecycleContext } from './kernl-lifecycle.js';
export { createKernel, toSession, type SessionCard } from './kernl.js';
export type { PlannedExtensions } from './applets/plan.js';
export { createMemorySecrets, createStorageSecrets, type SecretsDescription, type SecretsProvider } from './secrets/secrets.js';
export { addressOf } from './applets/address.js';
export { asFilters } from './applesauce/relay-hooks.js';
export { bindingMethod, supportsDomainBindings, type BoundPreludeOptions, type DomainBinding, type DomainBindingMethod } from './applets/domain-bindings.js';
export type { DownloadQuestion, DownloadQuestionLine, UploadDetails } from './asks/facts.js';
export type { HandlerDefaults, HandlerPreferences, InstalledApplet, InstalledContract } from './intents-contract.js';
