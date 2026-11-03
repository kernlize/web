/**
 * Opinionated shell composition over kehto and applesauce: adapters, applet
 * resolution and mounting, grants, consent summaries, layouts and persistence.
 *
 * @packageDocumentation
 */
import { renderNappletFramePolicyMeta } from '@kehto/shell';

export const PACKAGE_NAME = '@kernl/core';

/**
 * The `<meta>` element the host page puts in its `<head>` so applet frames can
 * never navigate away from their verified `srcdoc`. Rendered once by kehto.
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
  type IdentityProfile,
  type IdentityProviderOptions,
  type IdentityProviders,
  type RelayPermissions,
} from './applesauce/identity-providers.js';
export { KernlAccountManager, PLAINTEXT_KEY_ACCOUNT_TYPES, createKernlAccounts } from './applesauce/accounts.js';

export { decodePointer } from './applets/pointer.js';
export {
  BLOB_TIMEOUT_MS,
  defaultFetchBlob,
  fetchManifestEvent,
  openDefaultArtifactCache,
  resolveApplet,
  summarize,
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
  RUNTIME_OP_CLASSES,
  applyRuntimeFirewallRules,
  runtimeFirewallRules,
  type RuntimeFirewallRules,
  type RuntimeRateRule,
} from './guard/runtime-rules.js';

export { BASELINE_DOMAINS, DOMAIN_CAPABILITIES, capabilitiesForDomain, capabilitiesForDomains } from './grants/domain-capabilities.js';
export { createEnvironmentResolver, createGrants, type GrantsOptions, type KernlGrants } from './grants/grants.js';

export { abbreviate, describeChange, isDestructiveKind } from './consent/describe-change.js';
export {
  createConsentHandler,
  createSigningConsent,
  lookupReplaceable,
  type LookupBefore,
  type ResolveAppletIdentity,
  type SigningConsent,
  type SigningConsentOptions,
  type SigningTemplate,
} from './consent/handler.js';

export {
  createColumnsLayout,
  createDwindleLayout,
  createMasterStackLayout,
  floatingLayout,
  type LayoutOptions,
  type MasterStackOptions,
} from './wm/layouts.js';

export { MESSAGING_UNAVAILABLE_REASONS, createDefaultMessaging, type DefaultMessagingOptions } from './messaging/default-registry.js';
export { createDefaultBridges, type DefaultBridgesOptions } from './bridges/default-registry.js';

export { LINK_PROTOCOLS, createKernlServices, isTheme, resourceInitFor, type KernlServiceDeps, type KernlServices } from './kernl-services.js';
export { createShellAdapter, type ShellAdapterDeps } from './kernl-adapter.js';
export { createAppletLifecycle, resolveWindow, type AppletLifecycle, type LifecycleContext } from './kernl-lifecycle.js';
export { createKernl, toSession } from './kernl.js';
