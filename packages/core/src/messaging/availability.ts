import type { IAccount } from 'applesauce-accounts';
import type { ISigner } from 'applesauce-signers';
import type { ProviderAvailability } from '@kernl/messaging';
import { isReadOnlyAccount } from '../applesauce/auth-hooks.js';

/**
 * The encryption a messaging backend needs from the account signer.
 *
 * @example
 * ```ts
 * const method: MessagingEncryption = 'nip44';
 * ```
 */
export type MessagingEncryption = 'nip44' | 'nip04';

/**
 * The reasons kernl gives for a provider that cannot run. Every provider
 * reports the first two, which follow the active account; `noRuntime` is
 * reported only by a `ratchet` or `group` provider a host registered without a backend.
 *
 * @example
 * ```ts
 * MESSAGING_UNAVAILABLE_REASONS.signInRequired; // 'sign-in-required'
 * Object.values(MESSAGING_UNAVAILABLE_REASONS); // ['sign-in-required', 'signer-cannot-encrypt', 'no-runtime']
 * ```
 */
export const MESSAGING_UNAVAILABLE_REASONS: Readonly<Record<'signInRequired' | 'signerCannotEncrypt' | 'noRuntime', string>> = Object.freeze({
  signInRequired: 'sign-in-required',
  signerCannotEncrypt: 'signer-cannot-encrypt',
  noRuntime: 'no-runtime',
});

/**
 * Whether a signer can carry messages that need `method`.
 *
 * @param signer - The active account's signer, or `undefined` while nobody is signed in.
 * @param method - The encryption the provider uses.
 * @returns Available, or unavailable with `sign-in-required` or `signer-cannot-encrypt`.
 * @example
 * ```ts
 * signerAvailability(undefined, 'nip44'); // { available: false, reason: 'sign-in-required' }
 * signerAvailability(new PrivateKeySigner(), 'nip44'); // { available: true }
 * ```
 */
export function signerAvailability(signer: ISigner | undefined, method: MessagingEncryption): ProviderAvailability {
  if (!signer) return { available: false, reason: MESSAGING_UNAVAILABLE_REASONS.signInRequired };
  return signer[method] ? { available: true } : { available: false, reason: MESSAGING_UNAVAILABLE_REASONS.signerCannotEncrypt };
}

/**
 * The signer messaging may use for an account. A read-only account is signed
 * in but can neither sign nor decrypt, so it is offered without its
 * encryption methods and reports `signer-cannot-encrypt`.
 *
 * @param account - The active account, if any.
 * @returns The account itself, a signer without encryption for a read-only account, or `undefined`.
 * @example
 * ```ts
 * const signer = () => messagingSigner(accounts.active);
 * signerAvailability(signer(), 'nip44');
 * ```
 */
export function messagingSigner(account: IAccount | undefined): ISigner | undefined {
  if (!account || !isReadOnlyAccount(account)) return account;
  return { getPublicKey: () => account.getPublicKey(), signEvent: (template) => account.signEvent(template) };
}
