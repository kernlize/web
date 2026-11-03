import type { DmConversation, DmConversationPage, DmConversationQuery, DmMessage, DmMessagePage, DmMessageQuery } from '@napplet/core';
import { createConversationIdentifier } from 'applesauce-common/helpers/messages';

/** Decrypted messages for one account, grouped by conversation. Lives in memory only. */
export interface ConversationStore {
  /** The account the stored messages belong to. */
  readonly owner: string | undefined;
  /** Forget every message and start over for `owner`. */
  reset(owner?: string): void;
  /** Store a message; `false` when one with the same id is already in its conversation. */
  add(message: DmMessage, participants: readonly string[]): boolean;
  remove(conversationId: string, id: string): void;
  conversations(query?: DmConversationQuery): DmConversationPage;
  messages(query: DmMessageQuery): DmMessagePage;
}

interface Thread {
  readonly participants: readonly string[];
  readonly messages: DmMessage[];
}

const DEFAULT_CONVERSATION_LIMIT = 50;
const DEFAULT_MESSAGE_LIMIT = 100;

/**
 * The conversation id for a set of people: applesauce's identifier, the
 * sorted, deduplicated public keys joined by `:`. Both sides of a
 * conversation compute the same id because it includes the owner.
 *
 * @param participants - Every participant, the owner included.
 * @returns A stable id such as `"<pubkey a>:<pubkey b>"`.
 * @example
 * ```ts
 * conversationIdOf(['bb', 'aa', 'bb']); // 'aa:bb'
 * ```
 */
export function conversationIdOf(participants: readonly string[]): string {
  return createConversationIdentifier([...participants]);
}

function latest(thread: Thread): number {
  return Math.max(...thread.messages.map((message) => message.createdAt));
}

function page<T>(items: readonly T[], cursor: string | undefined, limit: number): { items: T[]; cursor?: string } {
  const offset = cursor === undefined ? 0 : Number.parseInt(cursor, 10) || 0;
  const slice = items.slice(offset, offset + limit);
  const end = offset + slice.length;
  return { items: slice, ...(end < items.length ? { cursor: String(end) } : {}) };
}

/**
 * An in-memory store of normalized messages for the account that owns it.
 * Messages are ordered by `createdAt`; a conversation's participants are the
 * people other than the owner, and it is a group when it has more than two
 * people. A conversation whose last message was removed is not listed.
 *
 * @returns An empty store with no owner.
 * @example
 * ```ts
 * const store = createConversationStore();
 * store.reset(me);
 * store.add(message, [me, alice]);
 * store.conversations().conversations[0]?.kind; // 'direct'
 * ```
 */
export function createConversationStore(): ConversationStore {
  const threads = new Map<string, Thread>();
  let owner: string | undefined;

  const summarize = (id: string, thread: Thread): DmConversation => {
    return {
      id,
      kind: thread.participants.length > 2 ? 'group' : 'direct',
      participants: thread.participants.filter((pubkey) => pubkey !== owner).map((pubkey) => ({ pubkey })),
      unread: thread.messages.filter((message) => message.status === 'received').length,
      updatedAt: latest(thread),
    };
  };

  return {
    get owner() {
      return owner;
    },
    reset(next) {
      owner = next;
      threads.clear();
    },
    add(message, participants) {
      const thread = threads.get(message.conversationId) ?? { participants: [...new Set(participants)].sort(), messages: [] };
      if (thread.messages.some((entry) => entry.id === message.id)) return false;
      thread.messages.push(message);
      thread.messages.sort((a, b) => a.createdAt - b.createdAt);
      threads.set(message.conversationId, thread);
      return true;
    },
    remove(conversationId, id) {
      const thread = threads.get(conversationId);
      thread?.messages.splice(thread.messages.findIndex((entry) => entry.id === id), 1);
    },
    conversations(query = {}) {
      const all = [...threads]
        .filter(([, thread]) => thread.messages.length > 0)
        .sort(([, a], [, b]) => latest(b) - latest(a))
        .map(([id, thread]) => summarize(id, thread));
      const result = page(all, query.cursor, query.limit ?? DEFAULT_CONVERSATION_LIMIT);
      return { conversations: result.items, ...(result.cursor === undefined ? {} : { cursor: result.cursor }) };
    },
    messages(query) {
      const all = threads.get(query.conversationId)?.messages ?? [];
      const result = page(all, query.cursor, query.limit ?? DEFAULT_MESSAGE_LIMIT);
      return { messages: result.items, ...(result.cursor === undefined ? {} : { cursor: result.cursor }) };
    },
  };
}
