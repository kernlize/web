import { createFallbackSubtle } from './subtle-fallback.js';

/** The parts of `Crypto` the fallback reads; a browser's `crypto` is one. */
export type CryptoScope = { crypto?: Partial<Pick<Crypto, 'getRandomValues' | 'randomUUID' | 'subtle'>> };

/** What {@link installCryptoFallback} had to add. Both false in a secure context. */
export interface CryptoFallbackReport {
  /** `crypto.randomUUID` was missing and is now built on `getRandomValues`. */
  readonly randomUUID: boolean;
  /** `crypto.subtle` was missing and is now {@link createFallbackSubtle}. */
  readonly subtle: boolean;
}

/**
 * Add `crypto.randomUUID` to a scope that lacks it, built on
 * `crypto.getRandomValues`, which browsers expose outside secure contexts.
 *
 * Self-contained so {@link renderRandomUuidFallbackScript} can serialise it
 * into an applet's srcdoc: an opaque-origin frame inherits its parent's
 * insecure context, and the applet runtime calls `randomUUID` per request.
 *
 * @param scope - The global to patch, usually `window`.
 * @returns Whether it added the function.
 * @example
 * ```ts
 * randomUuidFallback(globalThis); // false where randomUUID already exists
 * ```
 */
export function randomUuidFallback(scope: CryptoScope): boolean {
  const provider = scope.crypto;
  if (provider === undefined || typeof provider.randomUUID === 'function' || typeof provider.getRandomValues !== 'function') return false;
  const getRandomValues = provider.getRandomValues.bind(provider);
  const randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    const bytes = getRandomValues(new Uint8Array(16));
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  Object.defineProperty(provider, 'randomUUID', { value: randomUUID, configurable: true, writable: true });
  return true;
}

/**
 * Fill in the Web Crypto pieces a browser withholds outside a secure context,
 * so the shell works when served over plain HTTP from an onion or overlay
 * network address. `crypto.getRandomValues` is always present; `randomUUID`
 * and `subtle` are not. Existing implementations are never replaced.
 *
 * Call it once, before anything that may use Web Crypto.
 *
 * @param scope - The global to patch. Defaults to `globalThis`.
 * @returns What was added.
 * @example
 * ```ts
 * import { installCryptoFallback } from '@kernlize/core/crypto';
 * installCryptoFallback(); // { randomUUID: false, subtle: false } over HTTPS
 * ```
 */
export function installCryptoFallback(scope: CryptoScope = globalThis): CryptoFallbackReport {
  const randomUUID = randomUuidFallback(scope);
  const provider = scope.crypto;
  const subtle = provider !== undefined && provider.subtle === undefined && typeof provider.getRandomValues === 'function';
  if (subtle) Object.defineProperty(provider, 'subtle', { value: createFallbackSubtle(), configurable: true });
  return { randomUUID, subtle };
}

/**
 * The applet-side half: a `<script>` that runs {@link randomUuidFallback}
 * against the applet's window. The mount plan puts it before any applet
 * script.
 *
 * @returns The script element as HTML.
 * @example
 * ```ts
 * renderRandomUuidFallbackScript(); // '<script data-kernl-crypto-fallback>…</script>'
 * ```
 */
export function renderRandomUuidFallbackScript(): string {
  return `<script data-kernl-crypto-fallback>(${randomUuidFallback.toString()})(window);</script>`;
}
