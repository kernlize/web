/**
 * Opinionated shell composition over kehto and applesauce: adapters, applet
 * resolution and mounting, grants, consent summaries, layouts and persistence.
 *
 * @packageDocumentation
 */
export * from '@kernlize/kernel';
export * from '@kernlize/modules';
export * from './core-exports.js';
export { createKernl } from './create-kernl.js';
export { kernlModules } from './modules/default.js';
export { ratchet, createRatchetMessagesBackend, type RatchetMessagingOptions } from '@kernlize/modules/messaging/ratchet';
export { groups, createGroupMessagesBackend, type GroupMessagingOptions } from '@kernlize/modules/messaging/groups';
