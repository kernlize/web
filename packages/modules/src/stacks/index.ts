/**
 * The stacks module on its own, without importing kernl’s other modules.
 *
 * @packageDocumentation
 */
export { stacksModule } from '../modules/stacks.js';
export { DEFAULT_STACK_ID, STACK_KIND, STACK_START_TAG, newestStacks, toAppletStack, type AppletStack, type StackMember } from './stack.js';
export { STACK_EMIT_MS, STACK_LIMIT, STACK_SETTLE_MS, STACK_TIMEOUT_MS, loadStacks, stackRelays, streamStacks, type AppletStacks, type LoadStacksOptions } from './fetch.js';
