import type { Observable } from 'rxjs';
import type { EventStore } from 'applesauce-core';
import { isHexKey, unixNow, type NostrEvent } from 'applesauce-core/helpers';
import { getConversationParticipants } from 'applesauce-common/helpers/messages';
import type { ISigner } from 'applesauce-signers';
import type { DmMessage, DmSendRequest, DmStatus, NostrFilter } from '@napplet/core';
import type { MessagingBackend } from '@kernl/messaging';
import type { RelayTiers } from '../types.js';
import { subscribeWithEose, type ApplesaucePool, type EoseSubscription } from '../applesauce/relay-hooks.js';
import { createReplaceableLoader } from '../applesauce/identity-providers.js';
import { signerAvailability, type MessagingEncryption } from './availability.js';
import { conversationIdOf, createConversationStore } from './conversation-store.js';
import { createInboxRelays, type InboxRelays } from './inbox-relays.js';

/**
 * What a signer-backed messaging backend needs from the shell. `signer` and
 * `selfPubkey` are read on every call, so one backend follows the active account.
 *
 * @example
 * ```ts
 * const options: SignerMessagingOptions = {
 *   store: kernl.eventStore,
 *   pool: kernl.pool,
 *   tiers: kernl.relays,
 *   signer: () => kernl.accounts.active,
 *   selfPubkey: () => kernl.accounts.active?.pubkey,
 * };
 * ```
 */
export interface SignerMessagingOptions {
  /** The shell's event store; inbox relay lists are read from it. */
  readonly store: EventStore;
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  /** The active account's signer, read on every call. The only key holder the backend uses. */
  readonly signer: () => ISigner | undefined;
  /** The active account's public key, read on every call. */
  readonly selfPubkey: () => string | undefined;
  /** Clock in Unix seconds. Defaults to the wall clock. */
  readonly now?: () => number;
  /** Emits when the active account changes, so the inbox follows it without waiting for the next call. */
  readonly accountChanges?: Observable<unknown>;
}

/** A message read out of an event, before it is filed. */
export interface OpenedMessage {
  readonly id: string;
  readonly senderPubkey: string;
  /** Everyone the message names, sender included. */
  readonly participants: readonly string[];
  readonly createdAt: number;
  readonly content: string;
}

/** What a sealed message publishes: each event and the relays it goes to. */
export interface SealedMessage {
  readonly id: string;
  readonly outgoing: readonly { readonly event: NostrEvent; readonly relays: readonly string[] }[];
}

/** Everything a format needs to seal one message. */
export interface SealRequest {
  readonly signer: ISigner;
  readonly self: string;
  readonly others: readonly string[];
  readonly content: string;
  readonly createdAt: number;
  readonly inboxRelays: InboxRelays;
}

/** One message format: how to ask for, open and seal its events. */
export interface MessageFormat {
  readonly implementation: string;
  readonly encryption: MessagingEncryption;
  filters(self: string): NostrFilter[];
  /** Read an event addressed to or written by `self`; `undefined` for anything that does not open. */
  open(event: NostrEvent, self: string, signer: ISigner): Promise<OpenedMessage | undefined>;
  seal(request: SealRequest): Promise<SealedMessage>;
}

interface Subscriber {
  readonly conversationId?: string;
  readonly onMessage: (message: DmMessage) => void;
}

interface Inbox {
  readonly pubkey: string;
  ready: Promise<void>;
  handle?: EoseSubscription;
}

interface Session {
  readonly signer: ISigner;
  readonly self: string;
}

const CAPABILITIES = ['send', 'receive', 'subscribe', 'history'];

function recipientsOf(request: DmSendRequest, self: string): string[] {
  const named = request.conversationId === undefined ? request.recipients : getConversationParticipants(request.conversationId);
  if (request.conversationId !== undefined && !named.includes(self)) throw new Error('invalid:unknown-conversation');
  const others = [...new Set(named)].filter((pubkey) => pubkey !== self);
  if (others.length === 0) throw new Error('invalid:no-recipients');
  if (!others.every((pubkey) => isHexKey(pubkey))) throw new Error('invalid:recipient');
  return others;
}

async function publishAll(pool: ApplesaucePool, sealed: SealedMessage): Promise<void> {
  for (const { event, relays } of sealed.outgoing) {
    const results = await pool.publish([...relays], event).catch(() => []);
    if (!results.some((result) => result.ok)) throw new Error('unavailable:offline');
  }
}

/**
 * A `MessagingBackend` for one message format, over the active account's
 * signer. The backend keeps one inbox subscription for the active account and
 * files what it can open into an in-memory store; when the account changes or
 * signs out, the subscription closes and the store is cleared, so one
 * account's messages are never shown to another.
 *
 * Reads wait for events that already arrived to be opened. A send files the
 * message as `sent` before publishing it and takes it back out if no relay
 * accepted it; the copy that later arrives from the user's own inbox carries
 * the same id and is not delivered twice.
 *
 * @param options - Store, pool, tiers, signer and clock.
 * @param format - How the format seals and opens its events.
 * @returns A backend for `createDefaultMessaging`.
 * @example
 * ```ts
 * const backend = createSignerBackend(options, privateMessageFormat);
 * await backend.send({ recipients: [alice], content: 'hi' });
 * ```
 */
export function createSignerBackend(options: SignerMessagingOptions, format: MessageFormat): MessagingBackend {
  const now = options.now ?? unixNow;
  const inboxRelays = createInboxRelays(options.store, createReplaceableLoader(options.store, options.pool, options.tiers), options.tiers);
  const store = createConversationStore();
  const subscribers = new Map<string, Subscriber>();
  const pending = new Set<Promise<void>>();
  let inbox: Inbox | undefined;
  let subscriptionCount = 0;

  const signerOf = (): ISigner | undefined => (options.selfPubkey() === undefined ? undefined : options.signer());
  const session = (): Session => {
    const signer = signerOf();
    const availability = signerAvailability(signer, format.encryption);
    if (!availability.available) throw new Error(`unavailable:${availability.reason}`);
    return { signer: signer as ISigner, self: options.selfPubkey() as string };
  };

  const file = (self: string, opened: OpenedMessage): DmMessage => {
    const participants = [...new Set([self, ...opened.participants])];
    const message: DmMessage = {
      id: opened.id,
      conversationId: conversationIdOf(participants),
      senderPubkey: opened.senderPubkey,
      createdAt: opened.createdAt,
      content: opened.content,
      status: opened.senderPubkey === self ? 'sent' : 'received',
    };
    if (store.owner !== self || !store.add(message, participants)) return message;
    for (const subscriber of subscribers.values()) {
      if (subscriber.conversationId === undefined || subscriber.conversationId === message.conversationId) subscriber.onMessage(message);
    }
    return message;
  };

  const ingest = (self: string, signer: ISigner, event: NostrEvent): void => {
    const opening = format.open(event, self, signer).then(
      (opened) => void (opened && file(self, opened)),
      () => undefined,
    );
    pending.add(opening);
    void opening.finally(() => pending.delete(opening));
  };

  const closeInbox = (): void => {
    inbox?.handle?.unsubscribe();
    inbox = undefined;
    store.reset();
  };

  const openInbox = (current: Session): Promise<void> => {
    store.reset(current.self);
    const entry: Inbox = { pubkey: current.self, ready: Promise.resolve() };
    inbox = entry;
    entry.ready = inboxRelays(current.self).then((relays) => {
      if (inbox !== entry) return;
      entry.handle = subscribeWithEose(options.pool, relays, format.filters(current.self), (item) => {
        if (item !== 'EOSE') ingest(current.self, current.signer, item);
      });
    });
    return entry.ready;
  };

  const sync = async (): Promise<void> => {
    if (!signerAvailability(signerOf(), format.encryption).available) closeInbox();
    else if (inbox?.pubkey !== options.selfPubkey()) {
      closeInbox();
      await openInbox(session());
    } else await inbox?.ready;
    await Promise.all(pending);
  };

  const changes = options.accountChanges?.subscribe(() => void sync());

  return {
    status(): DmStatus {
      const self = options.selfPubkey();
      return {
        available: signerAvailability(signerOf(), format.encryption).available,
        ...(self === undefined ? {} : { ownerPubkey: self }),
        implementations: [format.implementation],
        capabilities: CAPABILITIES,
      };
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
      const current = session();
      const others = recipientsOf(request, current.self);
      await sync();
      const createdAt = now();
      const sealed = await format.seal({ ...current, others, content: request.content, createdAt, inboxRelays });
      const message = file(current.self, { id: sealed.id, senderPubkey: current.self, participants: others, createdAt, content: request.content });
      try {
        await publishAll(options.pool, sealed);
      } catch (error) {
        store.remove(message.conversationId, message.id);
        throw error;
      }
      return { ok: true, message };
    },
    async subscribe(request, onMessage) {
      await sync();
      subscriptionCount += 1;
      const subscriptionId = `${format.implementation}-${subscriptionCount}`;
      subscribers.set(subscriptionId, { ...(request.conversationId === undefined ? {} : { conversationId: request.conversationId }), onMessage });
      return { subscriptionId };
    },
    unsubscribe(subscriptionId) {
      return { ok: subscribers.delete(subscriptionId) };
    },
    close() {
      changes?.unsubscribe();
      subscribers.clear();
      closeInbox();
    },
  };
}
