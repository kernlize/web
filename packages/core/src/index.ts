/**
 * Opinionated shell composition over kehto and applesauce: adapters, applet
 * resolution and mounting, grants, consent summaries, layouts and persistence.
 *
 * @packageDocumentation
 */
export * from './kernel/index.js';
export { createKernl } from './create-kernl.js';
export { kernlModules } from './modules/default.js';
export { ratchet, createRatchetMessagesBackend, type RatchetMessagingOptions } from './messaging/ratchet/index.js';
export { groups, createGroupMessagesBackend, type GroupMessagingOptions } from './messaging/groups/index.js';
