import type { MessagingProvider } from '../types.js';
import { defineProvider, type ProviderDeps } from './define.js';

/**
 * The `ratchet` provider: double-ratchet sessions whose keys change with every
 * message. Experimental; both sides need an app that speaks it. Specified by
 * the nostr-double-ratchet draft.
 *
 * @param deps - Backend constructor and availability check supplied by the shell.
 * @returns A `MessagingProvider` with id `ratchet`.
 * @example
 * ```ts
 * registry.register(createRatchetMessagesProvider({
 *   createBackend: () => ratchetAdapter,
 *   available: () => (runtime ? { available: true } : { available: false, reason: 'no-ratchet-runtime' }),
 * }));
 * ```
 */
export function createRatchetMessagesProvider(deps: ProviderDeps): MessagingProvider {
  return defineProvider(
    {
      id: 'ratchet',
      name: 'Ratchet sessions',
      description: 'Per-session keys that change with every message. Both sides need an app that supports it.',
      properties: {
        forwardSecrecy: true,
        postCompromiseSecurity: true,
        metadataProtection: 'partial',
        requiresSameClient: true,
        groups: false,
        specification: 'nostr-double-ratchet (draft)',
        experimental: true,
      },
    },
    deps,
  );
}
