import { BehaviorSubject, combineLatest, distinctUntilChanged, map, of, Observable, switchMap, timer, type Subscription } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import type { RelayPool } from 'applesauce-relay';
import type { ISigner } from 'applesauce-signers';
import { unixNow, type NostrEvent } from 'applesauce-core/helpers';
import { subscribeWithEose } from '../applesauce/relay-hooks.js';
import { DEFAULT_SUGGESTIONS, type RelayDirectory } from './directory.js';
import { relayUrls, summarizePublish, toRelayUrl, type PublishAnswer, type PublishOutcome } from './publish-outcome.js';

/** The NIP-65 relay list kind. */
const RELAY_LIST_KIND = 10002;
/** The extreme cap on waiting for a lookup server that never finishes. */
const PATIENCE_MS = 15_000;
const SUGGESTED = 3;

/** Where an account is reached (inboxes, NIP-65 `read`) and where it writes (outboxes, `write`). */
export interface Mailboxes {
  readonly inboxes: readonly string[];
  readonly outboxes: readonly string[];
}

/** The account's published list, as the shell knows it now. */
export type MailboxState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing'; readonly suggested: Mailboxes }
  | { readonly status: 'found'; readonly mailboxes: Mailboxes; readonly event: NostrEvent };

/** The active account's inbox and outbox. */
export interface AccountMailboxes {
  /** The state, replayed to new subscribers. */
  readonly state$: Observable<MailboxState>;
  /** The state as of now. */
  state(): MailboxState;
  /**
   * Publish a new list. Resolves with who accepted it; rejects with `denied:read-only` or `invalid:relay-url`.
   * `onProgress` hears the outcome so far each time a server answers, when the pool can report answers one by one.
   */
  save(next: Mailboxes, onProgress?: (sofar: PublishOutcome) => void): Promise<PublishOutcome>;
}

/** The signer surface saving needs. */
export type MailboxSigner = Pick<ISigner, 'getPublicKey' | 'signEvent'>;

/** The pool surface the mailboxes need. */
export type MailboxPool = Pick<RelayPool, 'req' | 'publish'> & Partial<Pick<RelayPool, 'event'>>;

/** Options for {@link createAccountMailboxes}. */
export interface AccountMailboxesOptions {
  /** The shell's event store; found and saved lists are added to it. */
  readonly store: EventStore;
  readonly pool: MailboxPool;
  /** The active account's public key; the lookup follows it and ends when it completes. */
  readonly pubkey$: Observable<string | undefined>;
  /** Servers that index accounts' lists, asked on every lookup and every save. */
  readonly lookupRelays: () => readonly string[];
  /** The active account's signer, when it can sign. */
  readonly signer: () => MailboxSigner | undefined;
  /** Suggestions for an account with no list; the built-in ones without it. */
  readonly directory?: RelayDirectory;
  /** How long to wait for a lookup server that never finishes; 15 s by default. */
  readonly patienceMs?: number;
}

/**
 * Read a NIP-65 list. An unmarked `r` tag is both an inbox and an outbox; a
 * tag with any other marker, or a value that is not a `ws:` or `wss:` URL, is
 * skipped. applesauce's `getInboxes` is not used because its URL check refuses
 * top-level domains longer than six letters.
 *
 * @param event - A kind 10002 event, or nothing.
 * @returns Normalised inboxes and outboxes; empty for no event.
 * @example
 * ```ts
 * mailboxesFromEvent({ ...event, tags: [['r', 'wss://a.example'], ['r', 'wss://b.example', 'read']] });
 * // { inboxes: ['wss://a.example/', 'wss://b.example/'], outboxes: ['wss://a.example/'] }
 * ```
 */
export function mailboxesFromEvent(event: NostrEvent | undefined): Mailboxes {
  const inboxes = new Set<string>();
  const outboxes = new Set<string>();
  for (const [name, value = '', marker] of event?.tags ?? []) {
    const url = toRelayUrl(value);
    if (name !== 'r' || !url || (marker !== undefined && marker !== 'read' && marker !== 'write')) continue;
    if (marker !== 'write') inboxes.add(url);
    if (marker !== 'read') outboxes.add(url);
  }
  return { inboxes: [...inboxes], outboxes: [...outboxes] };
}

function strictUrls(urls: readonly string[]): string[] {
  return relayUrls(
    urls.map((url) => {
      if (!toRelayUrl(url)) throw new Error('invalid:relay-url');
      return url;
    }),
  );
}

/**
 * The tags of the next NIP-65 list: one `r` tag per server, unmarked when it
 * is both an inbox and an outbox, then every tag of the previous list that is
 * not an `r` tag, so what other clients wrote is kept.
 *
 * @param mailboxes - The inboxes and outboxes to publish.
 * @param previous - The list being replaced, if any.
 * @returns The tags. Throws `invalid:relay-url` for an entry that is not a `ws:` or `wss:` URL.
 * @example
 * ```ts
 * mailboxTags({ inboxes: ['wss://a.example', 'wss://b.example'], outboxes: ['wss://a.example'] });
 * // [['r', 'wss://a.example/'], ['r', 'wss://b.example/', 'read']]
 * ```
 */
export function mailboxTags(mailboxes: Mailboxes, previous?: NostrEvent): string[][] {
  const inboxes = strictUrls(mailboxes.inboxes);
  const outboxes = strictUrls(mailboxes.outboxes);
  const tags = relayUrls([...inboxes, ...outboxes]).map((url) => {
    if (!outboxes.includes(url)) return ['r', url, 'read'];
    if (!inboxes.includes(url)) return ['r', url, 'write'];
    return ['r', url];
  });
  const kept = (previous?.tags ?? []).filter((tag) => tag[0] !== 'r').map((tag) => [...tag]);
  return [...tags, ...kept];
}

function suggestions(directory: RelayDirectory | undefined): Mailboxes {
  if (!directory) {
    const general = relayUrls(DEFAULT_SUGGESTIONS.inbox).slice(0, SUGGESTED);
    return { inboxes: general, outboxes: relayUrls(DEFAULT_SUGGESTIONS.outbox).slice(0, SUGGESTED) };
  }
  const urls = (purpose: 'inbox' | 'outbox'): string[] => directory.suggest({ purpose, limit: SUGGESTED }).map((listing) => listing.url);
  return { inboxes: urls('inbox'), outboxes: urls('outbox') };
}

function sameState(a: MailboxState, b: MailboxState): boolean {
  if (a.status === 'found' && b.status === 'found') return a.event.id === b.event.id;
  if (a.status === 'missing' && b.status === 'missing') return JSON.stringify(a.suggested) === JSON.stringify(b.suggested);
  return a.status === b.status;
}

/** Becomes true once every lookup server has finished, or once the cap passes. */
function lookupFinished(options: AccountMailboxesOptions, pubkey: string): Observable<boolean> {
  return new Observable<boolean>((observer) => {
    observer.next(false);
    const finish = (): void => observer.next(true);
    const cap: Subscription = timer(options.patienceMs ?? PATIENCE_MS).subscribe(finish);
    const lookup = subscribeWithEose(options.pool, relayUrls(options.lookupRelays()), [{ kinds: [RELAY_LIST_KIND], authors: [pubkey] }], (item) => {
      if (item === 'EOSE') finish();
      else options.store.add(item as NostrEvent);
    });
    return () => {
      cap.unsubscribe();
      lookup.unsubscribe();
    };
  }).pipe(distinctUntilChanged());
}

function stateFor(options: AccountMailboxesOptions, pubkey: string | undefined): Observable<MailboxState> {
  if (pubkey === undefined) return of({ status: 'loading' });
  const listings$ = options.directory?.listings$ ?? of([]);
  return combineLatest([options.store.replaceable(RELAY_LIST_KIND, pubkey), lookupFinished(options, pubkey), listings$]).pipe(
    map(([event, finished]): MailboxState => {
      if (event) return { status: 'found', mailboxes: mailboxesFromEvent(event), event };
      if (!finished) return { status: 'loading' };
      return { status: 'missing', suggested: suggestions(options.directory) };
    }),
  );
}

/** Publish through the pool's per-server stream, reporting each answer; a server that never answers counts as refusing. */
function publishStreaming(publish: NonNullable<MailboxPool['event']>, relays: string[], event: NostrEvent, onProgress: (sofar: PublishOutcome) => void): Promise<PublishOutcome> {
  const answers: PublishAnswer[] = [];
  return new Promise((resolve) => {
    const finish = (): void => {
      const silent = relays.filter((url) => !answers.some((answer) => answer.from === url));
      resolve(summarizePublish([...answers, ...silent.map((from) => ({ ok: false, from, message: 'no answer' }))]));
    };
    publish(relays, event).subscribe({
      next(answer) {
        answers.push(answer);
        onProgress(summarizePublish(answers));
      },
      error: finish,
      complete: finish,
    });
  });
}

async function publishList(options: AccountMailboxesOptions, signer: MailboxSigner, next: Mailboxes, onProgress?: (sofar: PublishOutcome) => void): Promise<PublishOutcome> {
  const pubkey = await signer.getPublicKey();
  const previous = options.store.getReplaceable(RELAY_LIST_KIND, pubkey);
  const tags = mailboxTags(next, previous);
  const created_at = Math.max(unixNow(), (previous?.created_at ?? 0) + 1);
  const event = await signer.signEvent({ kind: RELAY_LIST_KIND, created_at, tags, content: previous?.content ?? '' });
  const old = mailboxesFromEvent(previous);
  // NIP-65: the list goes to where the account writes and is read, old and new, and to the indexers.
  const relays = relayUrls([...next.outboxes, ...old.outboxes, ...next.inboxes, ...options.lookupRelays()]);
  const stream = options.pool.event?.bind(options.pool);
  if (stream && onProgress) {
    // The list is shown as soon as one server holds it; the rest keep answering.
    const progress = (sofar: PublishOutcome): void => {
      if (sofar.ok) options.store.add(event);
      onProgress(sofar);
    };
    return publishStreaming(stream, relays, event, progress);
  }
  const outcome = await options.pool.publish(relays, event).then(summarizePublish, (error: unknown) => ({
    accepted: [],
    refused: relays.map((url) => ({ url, reason: String(error).replace(/^Error: /, '') })),
    ok: false,
  }));
  if (outcome.ok) options.store.add(event);
  return outcome;
}

/**
 * Watch the active account's NIP-65 list and save a new one.
 *
 * The list is streamed from `lookupRelays()` for whichever account `pubkey$`
 * names, added to the store, and kept open so a newer list from another
 * client replaces it; the store keeps the newest. The state is `loading`
 * until a list arrives or every server has finished, or failed, without one,
 * or `patienceMs` passes for a server that never answers; it is then
 * `missing` with suggestions from the directory. With nobody signed in it
 * stays `loading`. Saving signs the list with the active signer, publishes it
 * to the new outboxes, the old outboxes, the new inboxes and the lookup
 * servers, and succeeds when any of them accepts it (D-028). A list nobody
 * accepted is not added to the store, so the state never shows a list no
 * server holds.
 *
 * @param options - The store, pool, active account, lookup servers, signer and directory.
 * @returns The account's mailboxes.
 * @example
 * ```ts
 * const mailboxes = createAccountMailboxes({ store, pool, pubkey$, lookupRelays: () => tiers.get().discovery, signer });
 * mailboxes.state$.subscribe((state) => render(state));
 * const outcome = await mailboxes.save({ inboxes: ['wss://in.example'], outboxes: ['wss://out.example'] });
 * describeOutcome(outcome); // 'Saved to 3 of 4 servers'
 * ```
 */
export function createAccountMailboxes(options: AccountMailboxesOptions): AccountMailboxes {
  const state$ = new BehaviorSubject<MailboxState>({ status: 'loading' });
  options.pubkey$
    .pipe(switchMap((pubkey) => stateFor(options, pubkey)))
    .subscribe((state) => {
      if (!sameState(state$.value, state)) state$.next(state);
    });
  return {
    state$: state$.asObservable(),
    state: () => state$.value,
    async save(next, onProgress) {
      const signer = options.signer();
      if (!signer) throw new Error('denied:read-only');
      return publishList(options, signer, next, onProgress);
    },
  };
}
