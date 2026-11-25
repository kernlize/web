/**
 * The ratchet provider and its backend, with the library behind them. A shell imports this only
 * when it lists `ratchet()`.
 *
 * @packageDocumentation
 */
import { createRatchetMessagesProvider } from '@kernlize/messaging';
import { createRatchetMessagesBackend } from '../ratchet-backend.js';
import { messagingProviderModule, type MessagingProviderModule, type ProviderOptions } from '../provider-module.js';

export { createRatchetMessagesBackend, type RatchetMessagingOptions } from '../ratchet-backend.js';

/**
 * Messages with forward secrecy for the messaging module. Its library is loaded only by a shell
 * that lists this provider, so it is imported from `@kernlize/modules/messaging/ratchet`.
 *
 * @param options - A backend to run instead of kernl's own.
 * @returns The `ratchet` provider.
 * @example
 * ```ts
 * import { ratchet } from '@kernlize/modules/messaging/ratchet';
 * messagingModule({ providers: [privateDm(), ratchet()] });
 * ```
 */
export function ratchet(options: ProviderOptions = {}): MessagingProviderModule {
  return messagingProviderModule({ id: 'ratchet', describe: createRatchetMessagesProvider, encryption: 'nip44' }, createRatchetMessagesBackend, options);
}
