/**
 * The group provider and its backend, with the library behind them. A shell imports this only
 * when it lists `groups()`.
 *
 * @packageDocumentation
 */
import { createGroupMessagesProvider } from '@kernlize/messaging';
import { createGroupMessagesBackend } from '../group-backend.js';
import { messagingProviderModule, type MessagingProviderModule, type ProviderOptions } from '../provider-module.js';

export { createGroupMessagesBackend, type GroupMessagingOptions } from '../group-backend.js';

/**
 * Group conversations for the messaging module. Its library is loaded only by a shell that lists
 * this provider, so it is imported from `@kernlize/modules/messaging/groups`.
 *
 * @param options - A backend to run instead of kernl's own.
 * @returns The `group` provider.
 * @example
 * ```ts
 * import { groups } from '@kernlize/modules/messaging/groups';
 * messagingModule({ providers: [privateDm(), groups()] });
 * ```
 */
export function groups(options: ProviderOptions = {}): MessagingProviderModule {
  return messagingProviderModule({ id: 'group', describe: createGroupMessagesProvider, encryption: 'nip44' }, createGroupMessagesBackend, options);
}
