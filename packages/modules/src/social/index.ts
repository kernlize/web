/**
 * `@kernlize/modules/social`: the social module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export { createCommonActions, type CommonActionsOptions, type ConsentedSigner, type SignerAndGate } from '../social/common-actions.js';
export { socialModule } from '../modules/social.js';
export { commonActionsFor } from '../social/network-actions.js';
