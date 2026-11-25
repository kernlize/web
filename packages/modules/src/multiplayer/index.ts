/**
 * `@kernlize/modules/multiplayer`: the multiplayer module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export type { KernlMultiplayer } from '../multiplayer/types.js';
export { multiplayerModule, type MultiplayerModuleOptions } from '../modules/multiplayer.js';
export { createCvmRelayPool, createRemoteToolsService, mergeFamilies, type RemoteToolsOptions } from '../multiplayer/remote-tools.js';
export { createWindowIdentities, type WindowIdentities } from '../multiplayer/window-identities.js';
export { createMultiplayerSettings, validFamily, type MultiplayerSettings, type MultiplayerState } from '../multiplayer/settings.js';
export { discoverToolFamilies, TOOL_DISCOVERY_TIMEOUT_MS, type ToolDiscoveryOptions, type ToolFamilyCandidate } from '../multiplayer/tool-discovery.js';
export { createDirectConnectionsService, describeDirectConnection, directNamespace, type DirectConnectionsOptions } from '../multiplayer/direct-connections.js';
export { createDirectSignaling, DIRECT_MAX_PAYLOAD_BYTES, DIRECT_SIGNAL_KIND, DIRECT_SIGNALING_PROFILE, type DirectSignalingOptions, type SignalRelay, type SignalSigner } from '../multiplayer/direct-signaling.js';
