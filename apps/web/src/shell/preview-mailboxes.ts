import { BehaviorSubject, EMPTY } from 'rxjs';
import { createRelayDirectory, DEFAULT_SUGGESTIONS, type AccountMailboxes, type MailboxState, type RelayDirectory } from '@kernlize/core';

/** The preview's directory hears from no monitor, so it suggests from kernl's built-in list and completes nothing. */
export function createPreviewDirectory(): RelayDirectory {
  return createRelayDirectory({ pool: { subscription: () => EMPTY } });
}

/**
 * The preview account's inbox and outbox, kept in memory: it starts with none published, as a new
 * account does, and a save is accepted by every server because the preview reaches none.
 */
export function createPreviewMailboxes(): AccountMailboxes {
  const suggested = { inboxes: DEFAULT_SUGGESTIONS.inbox, outboxes: DEFAULT_SUGGESTIONS.outbox };
  const state$ = new BehaviorSubject<MailboxState>({ status: 'missing', suggested });
  return {
    state$: state$.asObservable(),
    state: () => state$.value,
    async save(next) {
      const accepted = [...new Set([...next.inboxes, ...next.outboxes])];
      state$.next({ status: 'found', mailboxes: { inboxes: [...next.inboxes], outboxes: [...next.outboxes] }, event: { kind: 10002, tags: [], content: '', created_at: 0, pubkey: '', id: '', sig: '' } });
      return { accepted, refused: [], ok: accepted.length > 0 };
    },
  };
}
