import { BehaviorSubject, EMPTY } from 'rxjs';
import type { ShellKernl } from './contract';
import { createMultiplayerSettings, createRelayDirectory, DEFAULT_FILE_SERVERS, DEFAULT_SUGGESTIONS, type AccountFileServers, type AccountMailboxes, type FileServerState, type KernlMultiplayer, type MailboxState, type RelayDirectory, type StorageLike } from '@kernlize/core';

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

/** The preview account's file servers: the defaults until it saves its own, kept in the page. */
export function createPreviewFileServers(): AccountFileServers {
  let current: readonly string[] = DEFAULT_FILE_SERVERS;
  const state$ = new BehaviorSubject<FileServerState>({ status: 'missing', servers: current });
  return {
    state$: state$.asObservable(),
    state: () => state$.value,
    current: async () => current,
    async save(servers) {
      current = [...servers];
      state$.next({ status: 'found', servers: [...servers], event: { kind: 10063, tags: [], content: '', created_at: 0, pubkey: '', id: '', sig: '' } });
      return { accepted: ['preview'], refused: [], ok: true };
    },
  };
}

/**
 * The preview's own settings for meeting people and remote tools: kept in its storage like the real
 * shell's, but it reaches no network, so a search for tools says so instead of finding any.
 */
export function createPreviewMultiplayer(storage: StorageLike): KernlMultiplayer {
  return {
    ...createMultiplayerSettings(storage),
    discover: () => Promise.reject(new Error('unavailable:preview')),
  };
}

/** The preview account's servers, file servers, meeting settings and directory, together. */
export function createPreviewAccountServices(storage: StorageLike): Pick<ShellKernl, 'mailboxes' | 'files' | 'multiplayer' | 'directory'> {
  return { mailboxes: createPreviewMailboxes(), files: createPreviewFileServers(), multiplayer: createPreviewMultiplayer(storage), directory: createPreviewDirectory() };
}
