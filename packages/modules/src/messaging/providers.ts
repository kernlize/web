import { createLegacyMessagesProvider, createPrivateMessagesProvider } from '@kernlize/messaging';
import { createLegacyMessagesBackend } from './legacy-backend.js';
import { createPrivateMessagesBackend } from './private-backend.js';
import { messagingProviderModule, type MessagingProviderModule, type ProviderOptions } from './provider-module.js';

/**
 * Sealed private messages (NIP-17) for the messaging module, over the active identity's signer.
 *
 * @param options - A backend to run instead of kernl's own.
 * @returns The `private` provider.
 * @example
 * ```ts
 * createKernel({ host, modules: [messagingModule({ providers: [privateDm()] })] });
 * ```
 */
export function privateDm(options: ProviderOptions = {}): MessagingProviderModule {
  return messagingProviderModule({ id: 'private', describe: createPrivateMessagesProvider, encryption: 'nip44' }, createPrivateMessagesBackend, options);
}

/**
 * Messages the older way (NIP-04) for the messaging module, over the active identity's signer.
 *
 * @param options - A backend to run instead of kernl's own.
 * @returns The `legacy` provider.
 * @example
 * ```ts
 * messagingModule({ providers: [privateDm(), legacyDm()] });
 * ```
 */
export function legacyDm(options: ProviderOptions = {}): MessagingProviderModule {
  return messagingProviderModule({ id: 'legacy', describe: createLegacyMessagesProvider, encryption: 'nip04' }, createLegacyMessagesBackend, options);
}
