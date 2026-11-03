import {
  createBridgeRegistry,
  createHandoffBackends,
  createHttpBridge,
  createMailBridge,
  createNzbBridge,
  createSoulseekBridge,
  createTorrentBridge,
  type BridgeRegistry,
  type BridgeRegistryOptions,
  type HandoffOpener,
  type HttpBridgeOptions,
} from '@kernl/bridges';

/** Options for {@link createDefaultBridges}. */
export interface DefaultBridgesOptions extends BridgeRegistryOptions {
  /** Passed to the web bridge: policy overrides, fetch and host resolver. */
  readonly http?: HttpBridgeOptions;
  /**
   * Opens a URI with an app on the user's device. When given, downloads, sharing and
   * mail resolve by handing the locator off through it; without it they report `unavailable`.
   */
  readonly handoff?: HandoffOpener;
}

/**
 * The shell's bridge registry: the web bridge, complete, plus the downloads, sharing
 * and mail bridges. With a `handoff` opener those four hand each locator to an app on
 * the user's device; without one they report `unavailable` (D-010).
 *
 * @param options - Consent hook, outcome observer, web bridge options and the hand-off opener.
 * @returns A `BridgeRegistry`.
 * @example
 * ```ts
 * createDefaultBridges().forScheme('magnet')?.availability(); // { available: false, reason: 'no-backend' }
 * const bridges = createDefaultBridges({ handoff: (uri) => host.openLink(uri) });
 * bridges.forScheme('magnet')?.availability(); // { available: true, handoff: true }
 * ```
 */
export function createDefaultBridges(options: DefaultBridgesOptions = {}): BridgeRegistry {
  const { http, handoff, ...registryOptions } = options;
  const registry = createBridgeRegistry(registryOptions);
  const backends = handoff ? createHandoffBackends(handoff) : undefined;
  registry.register(createHttpBridge(http));
  registry.register(createTorrentBridge(backends?.torrent));
  registry.register(createNzbBridge(backends?.nzb));
  registry.register(createSoulseekBridge(backends?.soulseek));
  registry.register(createMailBridge(backends?.mail));
  return registry;
}
