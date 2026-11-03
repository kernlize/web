/**
 * Locator parsing, the bridge contract, the registry that routes and authorises,
 * an HTTP bridge with an SSRF policy, backend-driven bridges for downloads,
 * sharing and mail, hand-off backends that open an app on the user's device, and
 * the adapter that feeds a resource service.
 *
 * @packageDocumentation
 */
export type {
  BackendTraits,
  Bridge,
  BridgeAuthorizer,
  BridgeAvailability,
  BridgeContext,
  BridgeExposure,
  BridgeRegistry,
  BridgeResult,
  HttpPolicy,
  Locator,
  MailBackend,
  NzbBackend,
  SoulseekBackend,
  TorrentBackend,
} from './types';
export { formatLocator, isNzbUrl, parseLocator } from './locator';
export { createBridgeRegistry } from './registry';
export type { BridgeRegistryOptions, BridgeResolveEvent } from './registry';
export { DEFAULT_HTTP_POLICY, createHttpBridge, isBlockedHostname, isPrivateAddress } from './http-bridge';
export type { HttpBridgeOptions } from './http-bridge';
export { createMailBridge, createNzbBridge, createSoulseekBridge, createTorrentBridge } from './backend-bridges';
export { createHandoffBackends } from './handoff-backends';
export type { HandoffBackends, HandoffOpener } from './handoff-backends';
export { createBridgeResourceResolver } from './resource-resolver';
export type { BridgeResourceResolver, BridgeResourceResolverOptions, ResourceResolveInit } from './resource-resolver';
export { describeBridge } from './describe';
export type { DescriptionRow } from './describe';
