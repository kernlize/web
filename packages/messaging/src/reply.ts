import type { DmConversation, DmPeer } from '@napplet/core';
import type { MessagingBackend } from './types.js';

const PAGE_SIZE = 100;
/** A backend whose cursors never end is not followed forever. */
const MAX_PAGES = 50;

async function findConversation(backend: MessagingBackend, match: (conversation: DmConversation) => boolean): Promise<DmConversation | undefined> {
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await backend.conversations(cursor === undefined ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, cursor });
    const found = page.conversations.find(match);
    if (found || page.cursor === undefined) return found;
    cursor = page.cursor;
  }
  return undefined;
}

const isWith = (pubkey: string) => (conversation: DmConversation): boolean =>
  conversation.kind === 'direct' && conversation.participants.length === 1 && conversation.participants[0]?.pubkey === pubkey;

/**
 * The one other person in a conversation, when it is one to one.
 *
 * @param backend - The provider's backend.
 * @param conversationId - The conversation's id as that backend knows it.
 * @returns The correspondent, or `undefined` for a group, a note to self or an unknown id.
 * @example
 * ```ts
 * (await directPeerOf(backend, 'direct:alice'))?.pubkey; // 'alice'
 * ```
 */
export async function directPeerOf(backend: MessagingBackend, conversationId: string): Promise<DmPeer | undefined> {
  const conversation = await findConversation(backend, (candidate) => candidate.id === conversationId);
  return conversation && conversation.kind === 'direct' && conversation.participants.length === 1 ? conversation.participants[0] : undefined;
}

/** A correspondent's newest message through one backend, with the peer as that backend describes them. */
export interface LastIncoming {
  readonly at: number;
  /** The participant record of their conversation, which carries a name when the backend knows one. */
  readonly peer: DmPeer;
}

/**
 * When a person last wrote to the user through one backend.
 *
 * @param backend - The provider's backend.
 * @param pubkey - The correspondent.
 * @param after - A time already found elsewhere; a conversation with no activity since is not read.
 * @returns Their newest message's `createdAt` and their peer record, or `undefined` when they never wrote through it.
 * @example
 * ```ts
 * await lastIncomingAt(backend, 'alice'); // { at: 1700000000, peer: { pubkey: 'alice' } }
 * ```
 */
export async function lastIncomingAt(backend: MessagingBackend, pubkey: string, after = 0): Promise<LastIncoming | undefined> {
  const conversation = await findConversation(backend, isWith(pubkey));
  if (!conversation || (conversation.updatedAt ?? Infinity) <= after) return undefined;
  let latest: number | undefined;
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await backend.messages({ conversationId: conversation.id, limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) });
    for (const message of page.messages) {
      if (message.senderPubkey === pubkey && message.createdAt > (latest ?? -Infinity)) latest = message.createdAt;
    }
    if (page.cursor === undefined) break;
    cursor = page.cursor;
  }
  return latest === undefined ? undefined : { at: latest, peer: conversation.participants[0] as DmPeer };
}

/** The provider a correspondent last wrote through, and their peer record there. */
export interface LastProvider {
  readonly id: string;
  readonly peer: DmPeer;
}

/**
 * Which of several backends a person last wrote through.
 *
 * @param backends - Enabled providers, in the user's order; a tie goes to the earlier one.
 * @param pubkey - The correspondent.
 * @returns The provider id and the peer as it names them, or `undefined` when they never wrote to the user.
 * @example
 * ```ts
 * (await lastProviderOf([{ id: 'private', backend }, { id: 'legacy', backend: other }], 'alice'))?.id; // 'legacy'
 * ```
 */
export async function lastProviderOf(backends: readonly { readonly id: string; readonly backend: MessagingBackend }[], pubkey: string): Promise<LastProvider | undefined> {
  let best: (LastIncoming & { id: string }) | undefined;
  for (const entry of backends) {
    const found = await lastIncomingAt(entry.backend, pubkey, best?.at);
    if (found && found.at > (best?.at ?? -Infinity)) best = { ...found, id: entry.id };
  }
  return best && { id: best.id, peer: best.peer };
}
