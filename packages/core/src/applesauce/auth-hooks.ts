import type { AccountManager, IAccount } from 'applesauce-accounts';
import type { AuthHooks } from '@kehto/shell';
import type { Signer } from '@kehto/runtime';
import type { SigningConsent } from '../consent/handler.js';

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
 * When kehto names the requesting window, the signer it gets back puts every
 * `signEvent` through `consent` first, so a destructive write an applet asks
 * for is shown to the user and signed only on yes (kehto's runtime signs
 * applet publishes here and asks nobody). Without a window the shell is
 * signing for itself and the plain signer is returned.
 *
 * @param accounts - The shell's account manager.
 * @param consent - The gate from `createSigningConsent`.
 * @returns Hooks for `ShellAdapter.auth`.
 * @example
 * ```ts
 * const auth = createAuthHooks(accounts, consent);
 * auth.getUserPubkey(); // hex pubkey or null
 * await auth.getSigner('applet-1')?.signEvent?.(profileTemplate); // asks the user first
 * ```
 */
export function createAuthHooks(accounts: AccountManager, consent: SigningConsent): AuthHooks {
  return {
    getUserPubkey: () => accounts.active?.pubkey ?? null,
    getSigner(windowId?: string) {
      const account = accounts.active;
      if (!account || isReadOnlyAccount(account)) return null;
      const signer = wrapAccountSigner(account);
      if (windowId === undefined) return signer;
      return {
        ...signer,
        async signEvent(template) {
          await consent(windowId, template);
          return account.signEvent(template);
        },
      } satisfies Signer;
    },
  };
}
