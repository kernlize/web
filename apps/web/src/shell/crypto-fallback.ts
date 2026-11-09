import { installCryptoFallback } from '@kernlize/core/crypto';

/**
 * Over plain HTTP from an onion or overlay address the page is not a secure
 * context, so the browser withholds `crypto.randomUUID` and `crypto.subtle`
 * (D-024). Shell.svelte imports this module first, so the fallback is in place
 * before any other module evaluates.
 */
export const cryptoFallback = installCryptoFallback();
