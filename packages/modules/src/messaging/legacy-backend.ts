import { kinds, mergeRelaySets, verifyEvent, type NostrEvent } from 'applesauce-core/helpers';
import { isValidLegacyMessage, unlockLegacyMessage } from 'applesauce-common/helpers/legacy-messages';
import { getConversationParticipants } from 'applesauce-common/helpers/messages';
import { LegacyMessageFactory } from 'applesauce-common/factories/legacy-message';
import type { ISigner } from 'applesauce-signers';
import type { MessagingBackend } from '@kernlize/messaging';
import { createSignerBackend, type MessageFormat, type OpenedMessage, type SignerMessagingOptions } from './signer-backend.js';

async function openLegacy(event: NostrEvent, self: string, signer: ISigner): Promise<OpenedMessage | undefined> {
  if (!isValidLegacyMessage(event) || !verifyEvent(event)) return undefined;
  const participants = getConversationParticipants(event);
  if (!participants.includes(self)) return undefined;
  const content = await unlockLegacyMessage(event, self, signer);
  return { id: event.id, senderPubkey: event.pubkey, participants, createdAt: event.created_at, content };
}

/**
 * The legacy direct-message format: one kind 4 event encrypted with `nip04`,
 * whose author and recipient are public.
 *
 * @example
 * ```ts
 * createSignerBackend(options, LEGACY_MESSAGE_FORMAT);
 * ```
 */
export const LEGACY_MESSAGE_FORMAT: MessageFormat = {
  implementation: 'nip04',
  encryption: 'nip04',
  filters: (self) => [
    { kinds: [kinds.EncryptedDirectMessage], '#p': [self] },
    { kinds: [kinds.EncryptedDirectMessage], authors: [self] },
  ],
  open: openLegacy,
  async seal({ signer, self, others, content, createdAt, inboxRelays }) {
    if (others.length > 1) throw new Error('invalid:groups-unsupported');
    const recipient = others[0] as string;
    const event = await LegacyMessageFactory.create(recipient, content).created(createdAt).sign(signer);
    return { id: event.id, outgoing: [{ event, relays: mergeRelaySets(...(await Promise.all([inboxRelays(recipient), inboxRelays(self)]))) }] };
  },
};

/**
 * A `MessagingBackend` for the legacy direct-message format (NIP-04) over the
 * active account's signer.
 *
 * Sending encrypts the text to the one recipient with `signer().nip04`, signs
 * the kind 4 event with the account and publishes it to the recipient's inbox
 * relays and the user's own, so the user's other devices see it too. Receiving
 * subscribes to kind 4 events addressed to or written by the user and decrypts
 * them with the same signer. Conversation ids and message shapes match
 * {@link createPrivateMessagesBackend}; groups are refused with
 * `invalid:groups-unsupported` because the format has none.
 *
 * @param options - Store, pool, tiers, and the active account's signer and public key.
 * @returns A backend for the `legacy` provider; available while the signer has `nip04`.
 * @example
 * ```ts
 * const backend = createLegacyMessagesBackend({
 *   store: kernl.eventStore,
 *   pool: kernl.pool,
 *   tiers: kernl.relays,
 *   signer: () => kernl.accounts.active,
 *   selfPubkey: () => kernl.accounts.active?.pubkey,
 * });
 * backend.subscribe({}, (message) => console.log(message.content));
 * ```
 */
export function createLegacyMessagesBackend(options: SignerMessagingOptions): MessagingBackend {
  return createSignerBackend(options, LEGACY_MESSAGE_FORMAT);
}
