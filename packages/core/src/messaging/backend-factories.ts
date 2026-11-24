import type { MessagingBackend } from '@kernlize/messaging';

/**
 * Backend constructors for `createDefaultMessaging`'s four providers. A provider whose
 * constructor is absent reports itself unavailable with a stable reason.
 */
export interface MessagingBackendFactories {
  readonly private?: () => MessagingBackend;
  readonly legacy?: () => MessagingBackend;
  readonly ratchet?: () => MessagingBackend;
  readonly group?: () => MessagingBackend;
}
