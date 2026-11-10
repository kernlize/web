import { BehaviorSubject, catchError, EMPTY, endWith, firstValueFrom, ignoreElements, map, of, switchMap, type Observable } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import { unixNow } from 'applesauce-core/helpers';
import { BLOSSOM_SERVER_LIST_KIND, getBlossomServersFromList, normalizeBlossomServer } from 'applesauce-common/helpers';
import type { ISigner } from 'applesauce-signers';
import type { NostrEvent } from '@napplet/core';
import type { ApplesaucePool } from '../applesauce/relay-hooks.js';
import { summarizePublish, type PublishOutcome } from '../relays/publish-outcome.js';
import type { ProfilePointer } from '../profiles/profiles.js';

/**
 * File servers to use when the account has not published its own list: public
 * Blossom servers that answered an upload preflight when this was chosen.
 *
 * @example
 * ```ts
 * DEFAULT_FILE_SERVERS[0]; // 'https://blossom.primal.net/'
 * ```
 */
export const DEFAULT_FILE_SERVERS: readonly string[] = Object.freeze(['https://blossom.primal.net/', 'https://nostr.download/', 'https://blossom.band/']);

/** Where the account's files go: its published list (BUD-03, kind 10063), or the defaults while it has none. */
export type FileServerState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing'; readonly servers: readonly string[] }
  | { readonly status: 'found'; readonly servers: readonly string[]; readonly event: NostrEvent };

/** The signed-in account's file servers. */
export interface AccountFileServers {
  readonly state$: Observable<FileServerState>;
  state(): FileServerState;
  /** The servers an upload goes to now: the published list once it is known, else the defaults. Waits only while the list is being looked up. */
  current(): Promise<readonly string[]>;
  /** Publish a new list. Rejects with `denied:read-only` or `invalid:server-url`. */
  save(servers: readonly string[]): Promise<PublishOutcome>;
}

/** Options for {@link createAccountFileServers}. */
export interface AccountFileServersOptions {
  readonly store: EventStore;
  readonly pool: Pick<ApplesaucePool, 'publish'>;
  /** Loads a replaceable event into the store and completes when the servers asked have answered. */
  readonly load: (pointer: ProfilePointer) => Observable<NostrEvent>;
  readonly pubkey$: Observable<string | undefined>;
  readonly pubkey: () => string | undefined;
  /** Where the list is looked up, and published to besides the account's outboxes. */
  readonly lookupRelays: () => readonly string[];
  /** Where the account publishes. */
  readonly outboxes: () => readonly string[];
  readonly signer: () => Pick<ISigner, 'signEvent'> | undefined;
  /** The servers used when no list is published; {@link DEFAULT_FILE_SERVERS} by default. */
  readonly defaults?: readonly string[];
}

/**
 * The servers a file-server list names, in its order, as root URLs.
 *
 * @param event - A kind 10063 list, or nothing.
 * @returns Server URLs, deduplicated.
 * @example
 * ```ts
 * fileServersFromEvent(list); // ['https://blossom.primal.net/']
 * ```
 */
export function fileServersFromEvent(event: NostrEvent | undefined): readonly string[] {
  return event ? [...new Set(getBlossomServersFromList(event).map((url) => url.href))] : [];
}

/**
 * The tags of a new file-server list: one `server` tag per server, in order,
 * with every other tag of the previous list kept.
 *
 * @param servers - Server URLs or hostnames.
 * @param previous - The list being replaced.
 * @returns Tags for a kind 10063 event. Throws `invalid:server-url` for something that is not a server.
 * @example
 * ```ts
 * fileServerTags(['blossom.primal.net']); // [['server', 'https://blossom.primal.net/']]
 * ```
 */
export function fileServerTags(servers: readonly string[], previous?: NostrEvent): string[][] {
  const urls = servers.map((server) => {
    try {
      return normalizeBlossomServer(server).href;
    } catch {
      throw new Error('invalid:server-url');
    }
  });
  const kept = (previous?.tags ?? []).filter((tag) => tag[0] !== 'server');
  return [...[...new Set(urls)].map((url) => ['server', url]), ...kept];
}

function stateFor(options: AccountFileServersOptions, pubkey: string | undefined): Observable<FileServerState> {
  const defaults = options.defaults ?? DEFAULT_FILE_SERVERS;
  if (pubkey === undefined) return of({ status: 'missing', servers: defaults });
  // The list is looked up until every server asked has answered; only then do the defaults stand in.
  const answered = options.load({ kind: BLOSSOM_SERVER_LIST_KIND, pubkey, relays: [...options.lookupRelays()] }).pipe(catchError(() => EMPTY), ignoreElements(), endWith(true));
  return options.store.replaceable(BLOSSOM_SERVER_LIST_KIND, pubkey).pipe(
    switchMap((event) => {
      if (event) return of<FileServerState>({ status: 'found', servers: fileServersFromEvent(event), event });
      return answered.pipe(map((): FileServerState => ({ status: 'missing', servers: defaults })));
    }),
  );
}

/**
 * Follow the active account's file-server list (BUD-03) and save a new one.
 *
 * Uploads go to these servers in order: the first gets the file, the rest
 * mirror it. An account with no published list uses the defaults. Saving signs
 * the list and publishes it to the account's outboxes and the lookup servers;
 * it succeeds when any of them accepts it (D-028).
 *
 * @param options - Store, pool, loader, account, servers and signer.
 * @returns The account's file servers.
 * @example
 * ```ts
 * const files = createAccountFileServers({ store, pool, load, pubkey$, pubkey, lookupRelays, outboxes, signer });
 * await files.current(); // ['https://blossom.primal.net/', …]
 * ```
 */
export function createAccountFileServers(options: AccountFileServersOptions): AccountFileServers {
  const state$ = new BehaviorSubject<FileServerState>({ status: 'loading' });
  options.pubkey$.pipe(switchMap((pubkey) => stateFor(options, pubkey))).subscribe((state) => state$.next(state));
  return {
    state$: state$.asObservable(),
    state: () => state$.value,
    current: () => firstValueFrom(state$.pipe(switchMap((state) => (state.status === 'loading' ? EMPTY : of(state.servers))))),
    async save(servers) {
      const signer = options.signer();
      const pubkey = options.pubkey();
      if (!signer || !pubkey) throw new Error('denied:read-only');
      const previous = options.store.getReplaceable(BLOSSOM_SERVER_LIST_KIND, pubkey);
      const tags = fileServerTags(servers, previous);
      const created_at = Math.max(unixNow(), (previous?.created_at ?? 0) + 1);
      const event = await signer.signEvent({ kind: BLOSSOM_SERVER_LIST_KIND, created_at, tags, content: previous?.content ?? '' });
      const relays = [...new Set([...options.outboxes(), ...options.lookupRelays()])];
      const outcome = await options.pool.publish(relays, event).then(summarizePublish, () => summarizePublish(relays.map((from) => ({ ok: false, from, message: 'publish failed' }))));
      if (outcome.ok) options.store.add(event);
      return outcome;
    },
  };
}
