/**
 * Messaging provider contract, registry and composite direct-message backend
 * for the kernl shell.
 *
 * @packageDocumentation
 *
 * @example
 * ```ts
 * PACKAGE_NAME; // '@kernlize/messaging'
 * ```
 */
export const PACKAGE_NAME = '@kernlize/messaging';

export type {
  MessagingBackend,
  MessagingPreferences,
  MessagingProvider,
  MessagingRegistry,
  ProviderAvailability,
  ProviderEntry,
  ReplyAnswer,
  ReplyPrompt,
  ReplyRule,
  SavedMessagingPreferences,
  SecurityProperties,
} from './types.js';
export { namespaceId, splitId, type NamespacedId } from './ids.js';
export { createCompositeBackend, type CompositeOptions, type EnabledBackend, type ReplyChoice, type WithProvider } from './composite.js';
export { createMessagingRegistry, type MessagingRegistryOptions } from './registry.js';
export {
  createMemoryBackend,
  type MemoryBackend,
  type MemoryBackendOptions,
  type MemoryIncoming,
} from './memory-backend.js';
export {
  createGroupMessagesProvider,
  createLegacyMessagesProvider,
  createPrivateMessagesProvider,
  createRatchetMessagesProvider,
  defineProvider,
  describeProvider,
  type ProviderDefinition,
  type ProviderDeps,
  type ProviderDescriptionRow,
} from './providers/index.js';
