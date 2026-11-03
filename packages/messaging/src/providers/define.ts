import type { MessagingBackend, MessagingProvider, ProviderAvailability, SecurityProperties } from '../types.js';

/**
 * What a provider factory needs from the shell. The shell injects the real
 * backend constructor and the availability check so this package never depends
 * on a relay library, a signer or a runtime.
 */
export interface ProviderDeps {
  /** Build the backend. The registry calls this once per enable. */
  readonly createBackend: () => MessagingBackend;
  /** Whether the provider can run right now, and if not, why. */
  readonly available: () => ProviderAvailability;
}

/** The fixed, user-facing part of a provider. */
export interface ProviderDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly properties: SecurityProperties;
}

/**
 * Join a fixed provider definition with injected shell dependencies.
 *
 * @param definition - Id, copy and security properties.
 * @param deps - Backend constructor and availability check.
 * @returns A `MessagingProvider` ready for `MessagingRegistry.register`.
 * @example
 * const provider = defineProvider(
 *   { id: 'demo', name: 'Demo', description: 'For previews.', properties },
 *   { createBackend: () => createMemoryBackend(), available: () => ({ available: true }) },
 * );
 */
export function defineProvider(definition: ProviderDefinition, deps: ProviderDeps): MessagingProvider {
  return {
    ...definition,
    availability: deps.available,
    createBackend: deps.createBackend,
  };
}
