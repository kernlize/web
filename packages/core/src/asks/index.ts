/**
 * The ask kinds and the ask channel on their own (D-067): what a host's UI needs to draw the
 * kernel's questions, without the network stack, as `wm`, `crypto`, `cache` and `seal` are loaded
 * (D-022).
 *
 * @packageDocumentation
 */
export { ASK_KINDS, ASK_REFUSALS, type Ask, type AskAnswer, type AskKind, type AskKinds, type AskRenderer, type AskRenderers, type AskSignal } from './kinds.js';
export { createAskChannel, toAskChannel, type AskChannel, type AskChannelOptions, type AskHost } from './channel.js';
