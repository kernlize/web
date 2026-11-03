import type { BridgeContext, BridgeRegistry } from './types';

/** What a resource service passes alongside the URL it wants resolved. */
export interface ResourceResolveInit {
  readonly signal?: AbortSignal;
  readonly headers?: Record<string, string>;
  /** The applet that asked, when the caller already knows it. */
  readonly requester?: BridgeContext['requester'];
}

/** Options for the resource resolver. */
export interface BridgeResourceResolverOptions {
  /** Derives the requester from the service's init (for example from its window id) when the init does not name one. */
  readonly requesterFor?: (init: ResourceResolveInit) => BridgeContext['requester'];
}

/** A resolver with the shape a resource service expects for its `fetch` option. */
export type BridgeResourceResolver = (url: string, init: ResourceResolveInit) => Promise<Response>;

/**
 * Adapts a bridge registry to the `fetch(url, init)` seam of a resource service.
 * Byte results are returned as they are; job and conversation results become a
 * `202 Accepted` JSON description so the caller can show progress. Failures reject
 * with the registry's prefixed reasons, which the service maps to its error envelope.
 *
 * @param registry - The registry that routes and authorises.
 * @param options - How to identify the requester when the init does not say.
 * @returns A resolver function.
 * @example
 * ```ts
 * const resourceService = createResourceService({
 *   fetch: createBridgeResourceResolver(registry, { requesterFor: (init) => identityFor(init) }),
 * });
 * ```
 */
export function createBridgeResourceResolver(
  registry: BridgeRegistry,
  options: BridgeResourceResolverOptions = {},
): BridgeResourceResolver {
  return async (url, init) => {
    const context: BridgeContext = {
      requester: init.requester ?? options.requesterFor?.(init) ?? 'shell',
      ...(init.signal ? { signal: init.signal } : {}),
      ...(init.headers ? { headers: init.headers } : {}),
    };
    const result = await registry.resolve(url, context);
    return result.kind === 'bytes' ? result.response : Response.json(result, { status: 202 });
  };
}
