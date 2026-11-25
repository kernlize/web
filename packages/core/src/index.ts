/**
 * Opinionated shell composition over kehto and applesauce: adapters, applet
 * resolution and mounting, grants, consent summaries, layouts and persistence.
 *
 * @deprecated Import from `@kernlize/kernel`, `@kernlize/modules` and `@kernlize/preset`; this package re-exports them for one minor (D-068).
 * @packageDocumentation
 */
export * from '@kernlize/kernel';
export * from '@kernlize/modules';
export * from '@kernlize/preset';
export * from './core-exports.js';
export { ratchet, createRatchetMessagesBackend, type RatchetMessagingOptions } from '@kernlize/modules/messaging/ratchet';
export { groups, createGroupMessagesBackend, type GroupMessagingOptions } from '@kernlize/modules/messaging/groups';
