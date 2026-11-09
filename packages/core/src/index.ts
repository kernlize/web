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

export {
  createRelayPoolHooks,
  createRelayPoolLike,
  selectRelayTier,
  subscribeWithEose,
  type ApplesaucePool,
  type EoseSubscription,
} from './applesauce/relay-hooks.js';
export { createAppletRelayBackend, createDmRelayPool, createOutboxRelayPool, type OutboxRelayPoolLike } from './applesauce/relay-backend.js';
export { createAuthHooks, isReadOnlyAccount, wrapAccountSigner } from './applesauce/auth-hooks.js';
export {
  createIdentityProviders,
  createReplaceableLoader,
  type IdentityProfile,
  type IdentityProviderOptions,
  type IdentityProviders,
  type RelayPermissions,
} from './applesauce/identity-providers.js';
export { KernlAccountManager, PLAINTEXT_KEY_ACCOUNT_TYPES, createKernlAccounts } from './applesauce/accounts.js';

export { decodePointer } from './applets/pointer.js';
export {
  BLOB_TIMEOUT_MS,
  MANIFEST_TIMING,
  defaultFetchBlob,
  fetchManifestEvent,
  openDefaultArtifactCache,
  resolveApplet,
  summarize,
  type ManifestTiming,
  type ResolveAppletOptions,
  type ResolvedApplet,
} from './applets/resolve.js';
export { planMount, type PlanMountOptions } from './applets/plan.js';
export { CONTROLLER_DENY_POLICY, mountApplet, type MountDeps, type MountGuardHooks, type MountedApplet } from './applets/mount.js';

export {
  createGuardPipeline,
  type GuardPipeline,
  type GuardPipelineOptions,
  type PipelineDisposition,
  type WindowResolution,
} from './guard/pipeline.js';
export {
  RUNTIME_FIREWALL_STORAGE_KEY,
  RUNTIME_OP_CLASSES,
  applyRuntimeFirewallProfile,
  applyRuntimeFirewallRules,
  createRuntimeFirewallHooks,
  runtimeFirewallRules,
  toGuardEvent,
  type RuntimeFirewallHooks,
  type RuntimeFirewallHooksOptions,
  type RuntimeFirewallRules,
  type RuntimeFirewallState,
  type RuntimeRateRule,
} from './guard/runtime-rules.js';

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

export { LINK_PROTOCOLS, createKernlServices, isTheme, resourceInitFor, type KernlServiceDeps, type KernlServices } from './kernl-services.js';
export { createShellAdapter, type ShellAdapterDeps } from './kernl-adapter.js';
export { createAppletLifecycle, resolveWindow, type AppletLifecycle, type LifecycleContext } from './kernl-lifecycle.js';
export { createKernl, toSession } from './kernl.js';
