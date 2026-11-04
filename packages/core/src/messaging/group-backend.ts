import { unixNow } from 'applesauce-core/helpers';
import type { ISigner } from 'applesauce-signers';
import { createApplicationMessageIntent, createChatRumor } from '@internet-privacy/marmot-ts';
import type { DmMessage, DmStatus } from '@napplet/core';
import type { MessagingBackend } from '@kernl/messaging';
import type { StorageLike } from '../types.js';
import { createReplaceableLoader } from '../applesauce/identity-providers.js';
import { signerAvailability } from './availability.js';
import { createConversationStore } from './conversation-store.js';
import { createGroupNetwork } from './group-network.js';
import { groupIdOf, membersOf, openGroupSession, type GroupSession, type GroupSessionContext } from './group-session.js';
import { createInboxRelays } from './inbox-relays.js';
import { recipientsOf, type SignerMessagingOptions } from './signer-backend.js';

const CAPABILITIES = ['send', 'receive', 'subscribe', 'history'];

/**
 * What the group backend needs: the signer-backend options plus storage for
 * the group library's state, which is sealed to the account before it is
 * written.
 *
 * @example
 * ```ts
 * const options: GroupMessagingOptions = { ...signerOptions, storage: localStorage };
 * ```
 */
export interface GroupMessagingOptions extends SignerMessagingOptions {
  readonly storage: StorageLike;
}

interface Subscriber {
  readonly conversationId?: string;
  readonly onMessage: (message: DmMessage) => void;
}

/**
 * A `MessagingBackend` for group sessions (Marmot, MLS over Nostr) over the
 * active account's signer, built on `@internet-privacy/marmot-ts`.
 *
 * The account signer proves who each member is and opens invitations; the
 * group library holds the group secrets, which move on with every commit, and
 * kernl seals everything the library stores to the account with `nip44`
 * (D-018). When an account first uses the backend it publishes a key package
 * (kind 30443) to its inbox relays and `outbox` tier, so others can start a
 * group with it, and publishes a fresh one after each invitation uses it up.
 *
 * A send to people goes to the group with exactly those members, else to a
 * new one that invites each of them by their key package; a recipient with
 * none is refused with `unavailable:recipient-not-ready`. Group events (kind
 * 445) go to the `outbox` and `super` tiers. Invitations arrive as gift wraps
 * on the user's inbox relays and are joined as they open. When the account
 * changes or signs out, the session closes and its messages are forgotten.
 *
 * Conversation ids are the group id in hex. A device is one member, so a
 * second device of the same account sees only groups it was invited to.
 *
 * @param options - Store, pool, tiers, storage, and the active account's signer and public key.
 * @returns A backend for the `group` provider; available while the signer has `nip44`.
 * @example
 * ```ts
 * const backend = createGroupMessagesBackend({
 *   store: kernl.eventStore,
 *   pool: kernl.pool,
 *   tiers: kernl.relays,
 *   storage: localStorage,
 *   signer: () => kernl.accounts.active,
 *   selfPubkey: () => kernl.accounts.active?.pubkey,
 * });
 * await backend.send({ recipients: [alice, bob], content: 'hello both' });
 * ```
 */
export function createGroupMessagesBackend(options: GroupMessagingOptions): MessagingBackend {
  const now = options.now ?? unixNow;
  const inboxRelays = createInboxRelays(options.store, createReplaceableLoader(options.store, options.pool, options.tiers), options.tiers);
  const store = createConversationStore();
  const subscribers = new Map<string, Subscriber>();
  const pending = new Set<Promise<unknown>>();
  let session: GroupSession | undefined;
  let subscriptionCount = 0;

  const deliver = (owner: string, message: DmMessage, participants: readonly string[]): DmMessage => {
    if (store.owner !== owner || !store.add(message, participants)) return message;
    for (const subscriber of subscribers.values()) {
      if (subscriber.conversationId === undefined || subscriber.conversationId === message.conversationId) subscriber.onMessage(message);
    }
    return message;
  };

  const context = (owner: string): GroupSessionContext => ({
    pool: options.pool,
    tiers: options.tiers,
    storage: options.storage,
    network: createGroupNetwork(options.pool, inboxRelays),
    inboxRelays,
    track(work) {
      pending.add(work);
      void work.finally(() => pending.delete(work));
    },
    deliver: (message, participants) => void deliver(owner, message, participants),
  });

  const signerOf = (): ISigner | undefined => (options.selfPubkey() === undefined ? undefined : options.signer());
  const close = (): void => {
    session?.close();
    session = undefined;
    store.reset();
  };

  const active = (): GroupSession => {
    const signer = signerOf();
    const availability = signerAvailability(signer, 'nip44');
    if (!availability.available) throw new Error(`unavailable:${availability.reason}`);
    const self = options.selfPubkey() as string;
    if (session?.self === self) return session;
    close();
    store.reset(self);
    session = openGroupSession(context(self), self, signer as ISigner);
    return session;
  };

  const sync = async (): Promise<void> => {
    if (!signerAvailability(signerOf(), 'nip44').available) return close();
    await active().ready;
    while (pending.size > 0) await Promise.all(pending);
  };

  const changes = options.accountChanges?.subscribe(() => void sync());

  return {
    status(): DmStatus {
      const self = options.selfPubkey();
      return {
        available: signerAvailability(signerOf(), 'nip44').available,
        ...(self === undefined ? {} : { ownerPubkey: self }),
        implementations: ['marmot'],
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
      const live = active();
      const client = await live.ready;
      const group =
        request.conversationId === undefined
          ? await live.groupFor(client, recipientsOf({ recipients: request.recipients, content: request.content }, live.self))
          : live.existing(client, request.conversationId);
      const rumor = createChatRumor({ pubkey: live.self, content: request.content, created_at: now() });
      const sent: DmMessage = { id: rumor.id, conversationId: groupIdOf(group), senderPubkey: live.self, createdAt: rumor.created_at, content: rumor.content, status: 'sent' };
      const message = deliver(live.self, sent, membersOf(group));
      const results = await client.groups.send(group.id, createApplicationMessageIntent(rumor)).catch(() => []);
      if (!results.some((result) => Object.values(result.response).some((response) => response.ok))) {
        store.remove(message.conversationId, message.id);
        throw new Error('unavailable:offline');
      }
      return { ok: true, message };
    },
    async subscribe(request, onMessage) {
      await sync();
      subscriptionCount += 1;
      const subscriptionId = `marmot-${subscriptionCount}`;
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
