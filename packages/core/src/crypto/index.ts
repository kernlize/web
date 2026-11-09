/**
 * Web Crypto for pages outside a secure context, on its own: `@kernlize/core/crypto` loads none of the
 * network stack, so a shell can install it before anything else runs. Everything here is also exported
 * from `@kernlize/core`.
 */
export { installCryptoFallback, randomUuidFallback, renderRandomUuidFallbackScript, type CryptoFallbackReport, type CryptoScope } from './install.js';
export { createFallbackSubtle } from './subtle-fallback.js';
