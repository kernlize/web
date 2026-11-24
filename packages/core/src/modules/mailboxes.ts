import { Subject, Subscription, takeUntil } from 'rxjs';
import { lookupRelaysOf } from '../applesauce/identity-providers.js';
import type { RelayDirectory } from '../relays/directory.js';
import { createAccountMailboxes, type AccountMailboxes, type AccountMailboxesOptions } from '../relays/mailboxes.js';
import type { KernlModule } from '../module-host/module.js';

/**
 * The signed-in identity's inboxes and outboxes (NIP-65): `kernl.mailboxes`. Where the identity
 * says it publishes becomes the shell's `outbox` tier, and a save is signed for the person with
 * the active signer (D-029, D-065). An identity with no list is offered the directory module's
 * suggestions when it is loaded, and the well-known servers otherwise. Without this module the
 * `outbox` tier stays as the host and the person set it.
 *
 * @param options - How long to wait for a lookup server that never finishes.
 * @returns The module; its api is `AccountMailboxes`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [directoryModule(), mailboxesModule()] });
 * await kernl.mailboxes.save({ inboxes: ['wss://in.example'], outboxes: ['wss://out.example'] });
 * ```
 */
export function mailboxesModule(options: Pick<AccountMailboxesOptions, 'patienceMs'> = {}): KernlModule<'mailboxes', AccountMailboxes> {
  return {
    id: 'mailboxes',
    setup(context) {
      const stopped$ = new Subject<void>();
      const mailboxes = createAccountMailboxes({
        ...options,
        store: context.eventStore,
        pool: context.pool,
        pubkey$: context.identity.pubkey$.pipe(takeUntil(stopped$)),
        lookupRelays: () => lookupRelaysOf(context.tiers.get()),
        signer: () => context.signer(),
        // Read once a list is known to be missing, so the directory may be loaded after this module.
        get directory() {
          return context.find<RelayDirectory>('directory');
        },
      });
      const following = new Subscription();
      // Where the identity says it publishes is where the shell publishes for it (NIP-65, D-029).
      following.add(mailboxes.state$.subscribe((state) => {
        if (state.status === 'found') context.tiers.set('outbox', state.mailboxes.outboxes);
      }));
      return {
        api: mailboxes,
        dispose() {
          following.unsubscribe();
          stopped$.next();
        },
      };
    },
  };
}
