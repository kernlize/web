import { verifyEvent, type NostrEvent } from 'applesauce-core/helpers';
import type { ISigner } from 'applesauce-signers';
import { NdrRuntime, type NdrRuntimeOptions, type Rumor } from 'nostr-double-ratchet';
import type { DmMessage, DmSendRequest, DmStatus, NostrFilter } from '@napplet/core';
import type { MessagingBackend } from '@kernlize/messaging';
import type { StorageLike } from '../types.js';
import { subscribeWithEose } from '../applesauce/relay-hooks.js';
import { signerAvailability } from './availability.js';
import { conversationIdOf, createConversationStore } from './conversation-store.js';
import { createSealedRatchetStorage } from './ratchet-storage.js';
import type { SignerMessagingOptions } from './signer-backend.js';

/** The library's rumour kind for a chat message; typing notices, receipts and controls use others. */
const CHAT_MESSAGE_KIND = 14;
const CAPABILITIES = ['send', 'receive', 'subscribe', 'history', 'double-ratchet'];

/**
 * What the ratchet backend needs: the signer backends' options plus the
 * storage the library's sealed state is kept in.
 *
 * @example
 * ```ts
 * const options: RatchetMessagingOptions = { ...signerOptions, storage: localStorage };
 * ```
 */
export interface RatchetMessagingOptions extends Omit<SignerMessagingOptions, 'store' | 'now'> {
  /** Where the library's device key and session state are kept, sealed to the account. */
  readonly storage: StorageLike;
  /**
   * How long the library waits for relays to return the account's device
   * list, as `{ fetchMs, fastMs }`. Defaults to the library's 10 s and 2 s.
   */
  readonly discoveryTimeouts?: { readonly fetchMs: number; readonly fastMs: number };
}

type Transport = Pick<NdrRuntimeOptions, 'nostrSubscribe' | 'nostrPublish' | 'nostrSign'>;

interface Account {
  readonly self: string;
  readonly runtime: NdrRuntime;
  readonly ready: Promise<void>;
  readonly detach: () => void;
  /** Set when setup failed, so the next call starts over. */
  failed?: boolean;
}

/**
 * The library's relay seams over kernl's pool. Ratchet traffic is read from
 * and written to the user's `outbox` and `super` tiers, so both sides must
 * share a relay (D-016). Owner events the library leaves unsigned are signed
 * by the account signer; device and session events arrive already signed by
 * keys the library holds.
 */
function transportFor(options: RatchetMessagingOptions, signer: ISigner): Transport {
  const relays = (): string[] => {
    const tiers = options.tiers.get();
    return [...new Set([...tiers.outbox, ...tiers.super])];
  };
  // The library leaves owner events with an empty `pubkey`; an account signer checks the hash it signs, so only the template goes to it.
  const sign = (event: NostrEvent): Promise<NostrEvent> =>
    typeof event.sig === 'string' ? Promise.resolve(event) : signer.signEvent({ kind: event.kind, created_at: event.created_at, tags: event.tags, content: event.content });
  type Verified = Awaited<ReturnType<NdrRuntimeOptions['nostrPublish']>>;
  return {
    nostrSign: async (event) => (await sign(event as NostrEvent)) as Verified,
    nostrSubscribe(filter, onEvent) {
      const handle = subscribeWithEose(options.pool, relays(), [filter as NostrFilter], (item) => {
        if (item !== 'EOSE' && verifyEvent(item)) onEvent(item as Verified);
      });
      return () => handle.unsubscribe();
    },
    async nostrPublish(event) {
      const signed = await sign(event as NostrEvent);
      const results = await options.pool.publish(relays(), signed).catch(() => []);
      if (!results.some((result) => result.ok)) throw new Error('unavailable:offline');
      return signed as Verified;
    },
  };
}

function recipientOf(request: DmSendRequest, self: string): string {
  const named = request.conversationId === undefined ? request.recipients : request.conversationId.split(':');
  if (request.conversationId !== undefined && !named.includes(self)) throw new Error('invalid:unknown-conversation');
  const others = [...new Set(named)].filter((pubkey) => pubkey !== self);
  if (others.length !== 1) throw new Error(others.length === 0 ? 'invalid:no-recipients' : 'invalid:groups-unsupported');
  return others[0] as string;
}

/**
 * A `MessagingBackend` for ratchet sessions (nostr-double-ratchet), over the
 * active account's signer.
 *
 * For each signed-in account the backend runs one `NdrRuntime`. The account
 * signer signs the owner's device list; the library generates and holds its
 * own device key and per-session ratchet keys, which never leave it except as
 * ciphertext sealed to the account by {@link createSealedRatchetStorage}.
 * Opening a runtime registers this browser as a device of the account and
 * publishes its invite, so a correspondent can start a session; sessions and
 * keys survive a reload, the conversation list does not (D-016).
 *
 * Only chat messages are filed: typing notices, receipts and controls are
 * dropped. Sessions are one to one, so a send names exactly one other person.
 * When the account changes or signs out the runtime closes and the
 * conversations are cleared.
 *
 * @param options - Pool, tiers, storage and the active account's signer and public key.
 * @returns A backend for the `ratchet` provider; available while the signer has `nip44`.
 * @example
 * ```ts
 * const backend = createRatchetMessagesBackend({
 *   pool: kernl.pool,
 *   tiers: kernl.relays,
 *   storage: localStorage,
 *   signer: () => kernl.accounts.active,
 *   selfPubkey: () => kernl.accounts.active?.pubkey,
 * });
 * await backend.send({ recipients: [alice], content: 'hello' });
 * ```
 */
export function createRatchetMessagesBackend(options: RatchetMessagingOptions): MessagingBackend {
  const timeouts = options.discoveryTimeouts;
  const discovery = timeouts ? { appKeysFetchTimeoutMs: timeouts.fetchMs, appKeysFastTimeoutMs: timeouts.fastMs } : {};
  const store = createConversationStore();
  const subscribers = new Map<string, { conversationId?: string; onMessage(message: DmMessage): void }>();
  let account: Account | undefined;
  let subscriptionCount = 0;

  const signerOf = (): ISigner | undefined => (options.selfPubkey() === undefined ? undefined : options.signer());
  const usable = (): boolean => signerAvailability(signerOf(), 'nip44').available;

  const file = (self: string, message: DmMessage, participants: readonly string[]): void => {
    if (store.owner !== self || !store.add(message, participants)) return;
    for (const subscriber of subscribers.values()) {
      if (subscriber.conversationId === undefined || subscriber.conversationId === message.conversationId) subscriber.onMessage(message);
    }
  };

  const received = (self: string) => (rumor: Rumor, from: string): void => {
    if (rumor.kind !== CHAT_MESSAGE_KIND) return;
    const tagged = rumor.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1] as string);
    const participants = [...new Set([self, from, ...tagged])];
    const status = from === self ? 'sent' : 'received';
    file(self, { id: rumor.id, conversationId: conversationIdOf(participants), senderPubkey: from, createdAt: rumor.created_at, content: rumor.content, status }, participants);
  };

  const close = (): void => {
    account?.detach();
    account?.runtime.close();
    account = undefined;
    store.reset();
  };

  const open = (self: string, signer: ISigner): Account => {
    store.reset(self);
    const runtime = new NdrRuntime({
      ...transportFor(options, signer),
      storage: createSealedRatchetStorage({ storage: options.storage, signer, owner: self }),
      ...discovery,
    });
    const detach = runtime.onSessionEvent(received(self));
    const ready = (async () => {
      await runtime.initForOwner(self);
      await runtime.ensureCurrentDeviceRegistered(self);
      await runtime.republishInvite();
    })();
    return { self, runtime, ready, detach };
  };

  const sync = async (): Promise<Account | undefined> => {
    if (!usable()) close();
    else if (account?.self !== options.selfPubkey() || account?.failed) {
      close();
      account = open(options.selfPubkey() as string, signerOf() as ISigner);
    }
    const current = account;
    await current?.ready.catch(() => {
      current.failed = true;
      throw new Error('unavailable:offline');
    });
    return current;
  };

  const changes = options.accountChanges?.subscribe(() => void sync().catch(() => undefined));

  return {
    status(): DmStatus {
      const self = options.selfPubkey();
      return { available: usable(), ...(self === undefined ? {} : { ownerPubkey: self }), implementations: ['ndr'], capabilities: CAPABILITIES };
    },
    async conversations(query) {
      await sync();
      return store.conversations(query);
    },
    async messages(query) {
      await sync();
      return store.messages(query);
    },
    async send(request) {
      const availability = signerAvailability(signerOf(), 'nip44');
      if (!availability.available) throw new Error(`unavailable:${availability.reason}`);
      const self = options.selfPubkey() as string;
      const recipient = recipientOf(request, self);
      const current = (await sync()) as Account;
      const rumor = await current.runtime.sendMessage(recipient, request.content);
      const participants = [self, recipient];
      const message: DmMessage = { id: rumor.id, conversationId: conversationIdOf(participants), senderPubkey: self, createdAt: rumor.created_at, content: request.content, status: 'sent' };
      file(self, message, participants);
      return { ok: true, message };
    },
    async subscribe(request, onMessage) {
      await sync();
      subscriptionCount += 1;
      const subscriptionId = `ndr-${subscriptionCount}`;
      subscribers.set(subscriptionId, { ...(request.conversationId === undefined ? {} : { conversationId: request.conversationId }), onMessage });
      return { subscriptionId };
    },
    unsubscribe(subscriptionId) {
      return { ok: subscribers.delete(subscriptionId) };
    },
    close() {
      changes?.unsubscribe();
      subscribers.clear();
      close();
    },
  };
}
