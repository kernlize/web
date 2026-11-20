/**
 * Locator parsing, the bridge contract, the registry that routes and authorises,
 * an HTTP bridge with an SSRF policy, a Blossom bridge that verifies what it
 * fetches, backend-driven bridges for downloads,
 * sharing and mail, hand-off backends that open an app on the user's device, an
 * in-page download backend over a WebTorrent client, and
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
export { createBlossomBridge, parseBlossomReference } from './blossom-bridge';
export type { BlossomBridgeOptions, BlossomReference } from './blossom-bridge';
export { createMailBridge, createNzbBridge, createSoulseekBridge, createTorrentBridge } from './backend-bridges';
export { createHandoffBackends } from './handoff-backends';
export { DEFAULT_WEBRTC_TRACKERS, createWebTorrentBackend, webTrackers } from './webtorrent-backend';
export type {
  DownloadJob,
  DownloadListener,
  DownloadState,
  DownloadedFile,
  WebTorrentBackend,
  WebTorrentBackendOptions,
  WebTorrentFileLike,
  WebTorrentLike,
  WebTorrentTorrentLike,
} from './webtorrent-backend';
export type { HandoffBackends, HandoffOpener } from './handoff-backends';
export { createBridgeResourceResolver } from './resource-resolver';
export type { BridgeResourceResolver, BridgeResourceResolverOptions, ResourceResolveInit } from './resource-resolver';
export { describeBridge } from './describe';
export type { DescriptionRow } from './describe';
export type {
  ClientEndpoint,
  ClientFailure,
  ClientFetch,
  ClientOptions,
  ClientProbe,
  NzbClient,
  NzbClientAction,
  NzbClientAdd,
  NzbClientAddOption,
  NzbClientCategory,
  NzbClientJob,
  NzbClientState,
  SoulseekClient,
  SoulseekClientFailure,
  SoulseekClientFile,
  SoulseekClientSearch,
  SoulseekClientTransfer,
  SoulseekClientTransferState,
  TorrentClient,
  TorrentClientFile,
  TorrentClientJob,
  TorrentClientLimits,
  TorrentClientSource,
  TorrentClientState,
  TorrentMetainfo,
} from './clients/types';
export { checkClientEndpoint, detectClientEndpoint, endpointCandidates } from './clients/endpoint';
export type { EndpointCheck, EndpointNote, PageScheme } from './clients/endpoint';
export { magnetInfoHash, readTorrentMetainfo } from './clients/torrent-metainfo';
export { createTransmissionClient } from './clients/transmission';
export { createUtorrentClient } from './clients/utorrent';
export { createNzbgetClient } from './clients/nzbget';
export { createSabnzbdClient } from './clients/sabnzbd';
export { createSlskdClient } from './clients/slskd';
