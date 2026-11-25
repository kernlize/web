/**
 * `@kernlize/modules/messaging`: the messaging module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export type { MessagingBackendFactories } from '../messaging/backend-factories.js';
export { createDefaultMessaging, createProviderMessaging, type DefaultMessagingOptions, type ProviderMessagingOptions, type RegisteredProvider } from '../messaging/default-registry.js';
export { MESSAGING_UNAVAILABLE_REASONS, messagingSigner, signerAvailability, type MessagingEncryption } from '../messaging/availability.js';
export type { SignerMessagingOptions } from '../messaging/signer-backend.js';
export { createPrivateMessagesBackend } from '../messaging/private-backend.js';
export { createLegacyMessagesBackend } from '../messaging/legacy-backend.js';
export { createSealedGroupStore, type SealedGroupStoreOptions } from '../messaging/group-storage.js';
export { createGroupNetwork } from '../messaging/group-network.js';
export type { InboxRelays } from '../messaging/inbox-relays.js';
export { createSealedRatchetStorage, type SealedRatchetStorageOptions } from '../messaging/ratchet-storage.js';
export { labelConversations } from '../messaging/label-conversations.js';
export { messagingModule, type MessagingModuleOptions } from '../modules/messaging.js';
export { legacyDm, privateDm } from '../messaging/providers.js';
export { messagingProviderModule, type MessagingProviderModule, type ProviderOptions, type ProviderParts } from '../messaging/provider-module.js';
export { locateRecipients, locateSendRecipients } from '../messaging/locate-recipients.js';
