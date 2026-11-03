import type { MessagingProvider } from '../types.js';
import { defineProvider, type ProviderDeps } from './define.js';

/**
 * The `private` provider: sealed messages that hide the sender and recipient
 * from the network. Specified by NIP-17.
 *
 * @param deps - Backend constructor and availability check supplied by the shell.
 * @returns A `MessagingProvider` with id `private`.
 * @example
 * registry.register(createPrivateMessagesProvider({
 *   createBackend: () => nip17Adapter,
 *   available: () => ({ available: true }),
 * }));
 */
export function createPrivateMessagesProvider(deps: ProviderDeps): MessagingProvider {
  return defineProvider(
    {
      id: 'private',
      name: 'Private messages',
      description: 'Sealed messages that hide who is talking to whom from the network.',
      properties: {
        forwardSecrecy: false,
        postCompromiseSecurity: false,
        metadataProtection: 'partial',
        requiresSameClient: false,
        groups: true,
        specification: 'NIP-17',
        experimental: false,
      },
    },
    deps,
  );
}
