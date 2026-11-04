import type { MessagingProvider } from '../types.js';
import { defineProvider, type ProviderDeps } from './define.js';

/**
 * The `group` provider: group sessions whose shared keys move on with every
 * change to the group, so a leaked key reveals neither earlier messages nor,
 * once the group moves on, later ones. Experimental; every member needs an
 * app that supports it. Specified by the Marmot protocol (MLS, RFC 9420,
 * over Nostr), which supersedes NIP-EE.
 *
 * @param deps - Backend constructor and availability check supplied by the shell.
 * @returns A `MessagingProvider` with id `group`.
 * @example
 * ```ts
 * registry.register(createGroupMessagesProvider({
 *   createBackend: () => groupAdapter,
 *   available: () => ({ available: true }),
 * }));
 * ```
 */
export function createGroupMessagesProvider(deps: ProviderDeps): MessagingProvider {
  return defineProvider(
    {
      id: 'group',
      name: 'Group sessions',
      description: 'Shared keys that change as the group talks and as people join or leave. Everyone needs an app that supports it.',
      properties: {
        forwardSecrecy: true,
        postCompromiseSecurity: true,
        metadataProtection: 'partial',
        requiresSameClient: true,
        groups: true,
        specification: 'Marmot (MLS, RFC 9420; supersedes NIP-EE)',
        experimental: true,
      },
    },
    deps,
  );
}
