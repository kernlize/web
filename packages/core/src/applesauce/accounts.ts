import { AccountManager, type IAccount, type SerializedAccount } from 'applesauce-accounts';
import { registerCommonAccountTypes } from 'applesauce-accounts/accounts';
import type { StorageLike } from '../types.js';
import { createNamespacedStore } from '../persistence/store.js';

const ACCOUNTS_KEY = 'accounts:v1';
const ACTIVE_KEY = 'active-account:v1';

/**
 * Account types whose serialised form carries a raw secret. `PrivateKeyAccount`
 * serialises the key itself and `SeedWordsAccount` the mnemonic. Neither may be
 * added to a kernl account manager: the only persisted form of a local key is
 * applesauce's `PasswordAccount`, whose `ncryptsec` is NIP-49 encrypted.
 *
 * @example
 * ```ts
 * PLAINTEXT_KEY_ACCOUNT_TYPES.includes(account.type); // true for 'nsec' and 'seed-words'
 * ```
 */
export const PLAINTEXT_KEY_ACCOUNT_TYPES: readonly string[] = Object.freeze(['nsec', 'seed-words']);

/**
 * An `AccountManager` that refuses accounts whose persistence would write a
 * plaintext key, and persists the rest to kernl's storage.
 *
 * @example
 * ```ts
 * const manager = new KernlAccountManager();
 * manager.addAccount(PasswordAccount.fromNcryptsec(pubkey, ncryptsec));
 * manager.addAccount(PrivateKeyAccount.fromKey(secretKey)); // throws 'denied:plaintext-key-persistence'
 * ```
 */
export class KernlAccountManager extends AccountManager {
  /**
   * Add an account, refusing plaintext-key types.
   *
   * @param account - The account to add.
   * @throws `denied:plaintext-key-persistence` for `PrivateKeyAccount` and `SeedWordsAccount`.
   */
  override addAccount(account: IAccount): void {
    if (PLAINTEXT_KEY_ACCOUNT_TYPES.includes(account.type)) throw new Error('denied:plaintext-key-persistence');
    super.addAccount(account);
  }
}

function restore(manager: AccountManager, accounts: SerializedAccount[], activeId: string | null): void {
  const safe = accounts.filter((entry) => !PLAINTEXT_KEY_ACCOUNT_TYPES.includes(entry.type));
  manager.fromJSON(safe, true);
  if (activeId && manager.getAccount(activeId)) manager.setActive(activeId);
}

/**
 * Create the shell's account manager with the common applesauce account types
 * registered, state restored from `kernl:accounts:v1` and
 * `kernl:active-account:v1`, and every later change persisted.
 *
 * Keys live only inside applesauce signer instances: a `PrivateKeyAccount` is
 * refused at `addAccount` with `denied:plaintext-key-persistence`, and any such
 * entry found in storage is dropped on restore. Wrap a local key as a
 * `PasswordAccount` before adding it.
 *
 * @param storage - Where accounts and the active id are persisted.
 * @returns The account manager.
 * @example
 * ```ts
 * const accounts = createKernlAccounts(localStorage);
 * accounts.addAccount(PasswordAccount.fromNcryptsec(pubkey, ncryptsec));
 * accounts.setActive(accounts.accounts[0]!);
 * ```
 */
export function createKernlAccounts(storage: StorageLike): AccountManager {
  const store = createNamespacedStore(storage, 'kernl');
  const manager = new KernlAccountManager();
  registerCommonAccountTypes(manager);
  restore(manager, store.getJson<SerializedAccount[]>(ACCOUNTS_KEY, []), store.getJson<string | null>(ACTIVE_KEY, null));

  manager.accounts$.subscribe(() => {
    store.setJson(ACCOUNTS_KEY, manager.toJSON(true));
  });
  manager.active$.subscribe((account) => {
    if (account) store.setJson(ACTIVE_KEY, account.id);
    else store.remove(ACTIVE_KEY);
  });
  return manager;
}
