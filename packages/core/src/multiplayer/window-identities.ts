import { PrivateKeySigner } from 'applesauce-signers';

/** A key per applet window that belongs to no account. */
export interface WindowIdentities {
  /** The window's signer, made the first time the window needs one. */
  signer(windowId: string): PrivateKeySigner;
  /** Wipe the window's key. The next use makes a new one. */
  release(windowId: string): void;
}

/**
 * Keys for the work a window does under its own name rather than the account's:
 * calling remote tools and reaching other people directly. Each window gets a
 * fresh key, so a server or a peer cannot link two applets, or one applet to
 * the account. The key lives in an applesauce signer, is never stored, and is
 * overwritten with zeros when the window ends (D-041).
 *
 * @returns The window identities.
 * @example
 * ```ts
 * const identities = createWindowIdentities();
 * const pubkey = await identities.signer('w1').getPublicKey();
 * identities.release('w1');
 * ```
 */
export function createWindowIdentities(): WindowIdentities {
  const signers = new Map<string, PrivateKeySigner>();
  return {
    signer(windowId) {
      let signer = signers.get(windowId);
      if (!signer) {
        signer = new PrivateKeySigner();
        signers.set(windowId, signer);
      }
      return signer;
    },
    release(windowId) {
      signers.get(windowId)?.key.fill(0);
      signers.delete(windowId);
    },
  };
}
