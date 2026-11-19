import { BaseAccount } from 'applesauce-accounts';
import type { SerializedAccount } from 'applesauce-accounts';
import { getPublicKey } from 'applesauce-core/helpers/keys';
import { PrivateKeySigner } from 'applesauce-signers';

/**
 * The type of an identity that is never written down.
 *
 * @example
 * ```ts
 * account.type === THROWAWAY_IDENTITY_TYPE; // true for createThrowawayIdentity()
 * ```
 */
export const THROWAWAY_IDENTITY_TYPE = 'throwaway';

/**
 * An identity for trying the shell: a fresh key held by its signer in memory
 * and nowhere else. It signs like any other, so the live store, applets and
 * consent all behave as they will for a kept identity. It refuses to be
 * serialised, so the account manager's persistence skips it and a reload
 * starts without it (D-044).
 *
 * @example
 * ```ts
 * const identity = createThrowawayIdentity();
 * await kernl.login(identity);
 * ```
 */
export class ThrowawayIdentity extends BaseAccount<PrivateKeySigner, never, { name: string }> {
  static readonly type = THROWAWAY_IDENTITY_TYPE;

  /**
   * Refuse to be written down.
   *
   * @throws `denied:plaintext-key-persistence`, always.
   */
  toJSON(): SerializedAccount<never, { name: string }> {
    throw new Error('denied:plaintext-key-persistence');
  }
}

/**
 * Make an identity that lasts until the page goes away.
 *
 * @param name - What the shell calls it until a profile says otherwise.
 * @returns The identity, ready for `kernl.login`.
 * @example
 * ```ts
 * await kernl.login(createThrowawayIdentity('Just looking'));
 * ```
 */
export function createThrowawayIdentity(name = 'Just looking'): ThrowawayIdentity {
  const signer = new PrivateKeySigner();
  const identity = new ThrowawayIdentity(getPublicKey(signer.key), signer);
  identity.metadata = { name };
  return identity;
}
