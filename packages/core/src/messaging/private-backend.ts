import { kinds, verifyEvent, type NostrEvent } from 'applesauce-core/helpers';
import { lockGiftWrap, unlockGiftWrap } from 'applesauce-common/helpers/gift-wrap';
import { getConversationParticipants } from 'applesauce-common/helpers/messages';
import { sealRumor, toRumor } from 'applesauce-common/operations/gift-wrap';
import { PrivateKeySigner } from 'applesauce-signers';
import type { MessagingBackend } from '@kernlize/messaging';
import { createSignerBackend, type MessageFormat, type OpenedMessage, type SignerMessagingOptions } from './signer-backend.js';

/** NIP-59 lets wraps carry a timestamp up to two days old so arrival times do not date the message. */
const WRAP_JITTER_SECONDS = 2 * 24 * 60 * 60;

/**
 * Wrap a seal for one recipient under a key that exists for this wrap only.
 * The key is generated inside an applesauce `PrivateKeySigner` and goes out of
 * scope when the wrap is signed; it is never stored (SOUL opinion 1).
 */
async function wrapForRecipient(recipient: string, seal: NostrEvent, createdAt: number): Promise<NostrEvent> {
  const ephemeral = new PrivateKeySigner();
  const content = await ephemeral.nip44.encrypt(recipient, JSON.stringify(seal));
  const jitter = Math.floor(Math.random() * WRAP_JITTER_SECONDS);
  return ephemeral.signEvent({ kind: kinds.GiftWrap, created_at: createdAt - jitter, tags: [['p', recipient]], content });
}

async function openWrap(event: NostrEvent, self: string, signer: Parameters<MessageFormat['open']>[2]): Promise<OpenedMessage | undefined> {
  const addressed = event.tags.some((tag) => tag[0] === 'p' && tag[1] === self);
  if (event.kind !== kinds.GiftWrap || !addressed || !verifyEvent(event)) return undefined;
  const rumor = await unlockGiftWrap(event, signer);
  lockGiftWrap(event);
  if (rumor.kind !== kinds.PrivateDirectMessage) return undefined;
  return { id: rumor.id, senderPubkey: rumor.pubkey, participants: getConversationParticipants(rumor), createdAt: rumor.created_at, content: rumor.content };
}

/**
 * The private message format: a kind 14 rumour sealed in a kind 13 event the
 * account signs, wrapped in a kind 1059 event signed by a one-time key.
 *
 * @example
 * ```ts
 * createSignerBackend(options, PRIVATE_MESSAGE_FORMAT);
 * ```
 */
export const PRIVATE_MESSAGE_FORMAT: MessageFormat = {
  implementation: 'nip17',
  encryption: 'nip44',
  filters: (self) => [{ kinds: [kinds.GiftWrap], '#p': [self] }],
  open: openWrap,
  async seal({ signer, self, others, content, createdAt, inboxRelays }) {
    // The rumour is built by hand: applesauce's text-content operation tags anyone mentioned in the text,
    // which would add them to the conversation on the reader's side.
    const rumor = await toRumor(signer)({ kind: kinds.PrivateDirectMessage, created_at: createdAt, content, tags: others.map((pubkey) => ['p', pubkey]) });
    const targets = [...others, self];
    const relays = await Promise.all(targets.map((target) => inboxRelays(target)));
    const outgoing = [];
    for (const [index, target] of targets.entries()) {
      const seal = await sealRumor(target, signer)(rumor);
      outgoing.push({ event: await wrapForRecipient(target, seal, createdAt), relays: relays[index] as string[] });
    }
    return { id: rumor.id, outgoing };
  },
};

/**
 * A `MessagingBackend` for private messages (NIP-17) over the active account's
 * signer.
 *
 * Sending builds a kind 14 rumour, seals it once per recipient and once for
 * the user in a kind 13 event signed by `signer()` and encrypted with its
 * `nip44`, and wraps each seal in a kind 1059 event signed by an ephemeral key
 * that lives only inside an applesauce `PrivateKeySigner` for that one wrap.
 * Each wrap goes to its recipient's kind 10050 inbox relays, or to the
 * `outbox` and `super` tiers when they publish none. Receiving subscribes to
 * kind 1059 events tagged with the user on the user's own inbox relays and
 * opens them with applesauce's gift-wrap helpers and the same signer; a wrap
 * that does not open, or holds anything but a kind 14 rumour, is ignored.
 *
 * Conversation ids are the sorted participant set, the user included, so both
 * sides of a conversation use the same id. Message ids are the rumour id, so
 * the copy addressed to the user is not filed twice.
 *
 * @param options - Store, pool, tiers, and the active account's signer and public key.
 * @returns A backend for the `private` provider; available while the signer has `nip44`.
 * @example
 * ```ts
 * const backend = createPrivateMessagesBackend({
 *   store: kernl.eventStore,
 *   pool: kernl.pool,
 *   tiers: kernl.relays,
 *   signer: () => kernl.accounts.active,
 *   selfPubkey: () => kernl.accounts.active?.pubkey,
 * });
 * await backend.send({ recipients: [alice], content: 'hello' });
 * ```
 */
export function createPrivateMessagesBackend(options: SignerMessagingOptions): MessagingBackend {
  return createSignerBackend(options, PRIVATE_MESSAGE_FORMAT);
}
