import type { AccountManager, IAccount } from 'applesauce-accounts';
import type { AuthHooks } from '@kehto/shell';
import type { Signer } from '@kehto/runtime';

/** Account types whose signer cannot sign. Mirrors `ReadonlyAccount.type` without importing the class. */
const READ_ONLY_TYPES: ReadonlySet<string> = new Set(['readonly']);

/**
 * Whether an account can only show an identity, never sign for it.
 *
 * @param account - Any applesauce account.
 * @returns True for read-only accounts.
 * @example
 * ```ts
 * isReadOnlyAccount(ReadonlyAccount.fromPubkey(pubkey)); // true
 * ```
 */
export function isReadOnlyAccount(account: IAccount): boolean {
  return READ_ONLY_TYPES.has(account.type);
}

/**
 * Wrap an account as the NIP-07-shaped signer kehto expects.
 *
 * The account itself is never handed over: kehto sees four methods and the
 * encryption namespaces the account exposes, nothing that reveals key material.
 *
 * @param account - The active applesauce account.
 * @returns A kehto `Signer`.
 * @example
 * ```ts
 * const signer = wrapAccountSigner(account);
 * await signer.signEvent?.(template);
 * ```
 */
export function wrapAccountSigner(account: IAccount): Signer {
  const signer: Signer = {
    getPublicKey: () => account.getPublicKey(),
    signEvent: (template) => account.signEvent(template),
  };
  if (account.nip04) signer.nip04 = account.nip04;
  if (account.nip44) signer.nip44 = account.nip44;
  return signer;
}

/**
 * kehto `AuthHooks` over the applesauce `AccountManager`.
 *
 * `getSigner` returns null while nobody is signed in and for read-only accounts,
 * so the runtime refuses writes instead of failing inside a signer that throws.
 *
 * @param accounts - The shell's account manager.
 * @returns Hooks for `ShellAdapter.auth`.
 * @example
 * ```ts
 * const auth = createAuthHooks(accounts);
 * auth.getUserPubkey(); // hex pubkey or null
 * ```
 */
export function createAuthHooks(accounts: AccountManager): AuthHooks {
  return {
    getUserPubkey: () => accounts.active?.pubkey ?? null,
    getSigner() {
      const account = accounts.active;
      if (!account || isReadOnlyAccount(account)) return null;
      return wrapAccountSigner(account);
    },
  };
}
