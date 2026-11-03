import {
  createBridgeRegistry,
  createHttpBridge,
  createMailBridge,
  createNzbBridge,
  createSoulseekBridge,
  createTorrentBridge,
  type BridgeRegistry,
  type BridgeRegistryOptions,
  type HttpBridgeOptions,
} from '@kernl/bridges';

/** Options for {@link createDefaultBridges}. */
export interface DefaultBridgesOptions extends BridgeRegistryOptions {
  /** Passed to the web bridge: policy overrides, fetch and host resolver. */
  readonly http?: HttpBridgeOptions;
}

/**
 * The shell's bridge registry: the web bridge, complete, plus the four bridges
 * that report `unavailable` until a backend exists (D-010).
 *
 * @param options - Consent hook, outcome observer and web bridge options.
 * @returns A `BridgeRegistry`.
 * @example
 * ```ts
 * const bridges = createDefaultBridges();
 * bridges.forScheme('magnet')?.availability(); // { available: false, reason: 'no-backend' }
 * ```
 */
export function createDefaultBridges(options: DefaultBridgesOptions = {}): BridgeRegistry {
  const { http, ...registryOptions } = options;
  const registry = createBridgeRegistry(registryOptions);
  registry.register(createHttpBridge(http));
  registry.register(createTorrentBridge());
  registry.register(createNzbBridge());
  registry.register(createSoulseekBridge());
  registry.register(createMailBridge());
  return registry;
}
