import type { MessagingProvider } from '../types.js';
import { defineProvider, type ProviderDeps } from './define.js';

/**
 * The `legacy` provider: the original direct-message format, readable by the
 * widest range of apps but exposing who talks to whom. Specified by NIP-04.
 *
 * @param deps - Backend constructor and availability check supplied by the shell.
 * @returns A `MessagingProvider` with id `legacy`.
 * @example
 * ```ts
 * registry.register(createLegacyMessagesProvider({
 *   createBackend: () => nip04Adapter,
 *   available: () => ({ available: true }),
 * }));
 * ```
 */
export function createLegacyMessagesProvider(deps: ProviderDeps): MessagingProvider {
  return defineProvider(
    {
      id: 'legacy',
      name: 'Legacy messages',
      description:
        'The original direct-message format. Readable by the widest range of apps, but who you talk to is visible on the network.',
      properties: {
        forwardSecrecy: false,
        postCompromiseSecurity: false,
        metadataProtection: 'none',
        requiresSameClient: false,
        groups: false,
        specification: 'NIP-04',
        experimental: false,
      },
    },
    deps,
  );
}
