import { parseLocator } from './locator';
import type { Bridge, BridgeAuthorizer, BridgeContext, BridgeRegistry, BridgeResult, Locator } from './types';

/** One resolution outcome, emitted for every call to `BridgeRegistry.resolve`. */
export interface BridgeResolveEvent {
  /** The bridge that handled the request, or `none` when no bridge serves the scheme. */
  readonly bridge: string;
  readonly scheme: string;
  readonly ok: boolean;
  /** The prefixed reason when `ok` is false. */
  readonly reason?: string;
}

/** Hooks the shell wires into a registry. */
export interface BridgeRegistryOptions {
  /** Consent check run before every resolution. Absent means every request is allowed. */
  readonly authorize?: BridgeAuthorizer;
  /** Observer for every outcome, successful or not. */
  readonly onResolve?: (event: BridgeResolveEvent) => void;
}

function normaliseScheme(scheme: string): string {
  return scheme.toLowerCase().replace(/:$/, '');
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates the registry the shell holds: it owns every bridge, routes a locator to the
 * bridge that serves its scheme, and runs the consent hook before resolving.
 *
 * @param options - Consent hook and outcome observer.
 * @returns A registry.
 * @example
 * ```ts
 * const registry = createBridgeRegistry({
 *   authorize: (locator, bridge) => confirm(`Open ${formatLocator(locator)} with ${bridge.label}?`),
 *   onResolve: (event) => log.push(event),
 * });
 * registry.register(createHttpBridge());
 * const result = await registry.resolve('https://example.com/file.bin', { requester: 'shell' });
 * ```
 */
export function createBridgeRegistry(options: BridgeRegistryOptions = {}): BridgeRegistry {
  const bridges = new Map<string, Bridge>();
  const byScheme = new Map<string, Bridge>();

  const fail = (bridge: string, scheme: string, reason: string): never => {
    options.onResolve?.({ bridge, scheme, ok: false, reason });
    throw new Error(reason);
  };

  const parse = (uri: string): Locator => {
    try {
      return parseLocator(uri);
    } catch (error) {
      return fail('none', '', reasonOf(error));
    }
  };

  const run = async (bridge: Bridge, locator: Locator, context: BridgeContext): Promise<BridgeResult> => {
    try {
      const result = await bridge.resolve(locator, context);
      options.onResolve?.({ bridge: bridge.id, scheme: locator.scheme, ok: true });
      return result;
    } catch (error) {
      return fail(bridge.id, locator.scheme, reasonOf(error));
    }
  };

  return {
    register(bridge) {
      if (bridges.has(bridge.id)) throw new Error(`invalid:duplicate-bridge ${bridge.id}`);
      const schemes = bridge.schemes.map(normaliseScheme);
      const taken = schemes.find((scheme) => byScheme.has(scheme));
      if (taken !== undefined) throw new Error(`invalid:scheme-taken ${taken}`);
      bridges.set(bridge.id, bridge);
      for (const scheme of schemes) byScheme.set(scheme, bridge);
    },
    list: () => [...bridges.values()],
    forScheme: (scheme) => byScheme.get(normaliseScheme(scheme)),
    async resolve(uri, context) {
      const locator = parse(uri);
      const bridge = byScheme.get(locator.scheme);
      if (!bridge) return fail('none', locator.scheme, 'unavailable:no-bridge');
      const availability = bridge.availability();
      if (!availability.available) return fail(bridge.id, locator.scheme, `unavailable:${availability.reason}`);
      const allowed = options.authorize ? await options.authorize(locator, bridge, context) : true;
      if (!allowed) return fail(bridge.id, locator.scheme, 'denied:bridge');
      return run(bridge, locator, context);
    },
  };
}
