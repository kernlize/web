import type {
  DmConversation,
  DmConversationPage,
  DmConversationQuery,
  DmMessage,
  DmMessagePage,
  DmMessageQuery,
  DmOk,
  DmPeer,
  DmSendRequest,
  DmSendResult,
  DmStatus,
  DmSubscribeRequest,
  DmSubscription,
} from '@napplet/core';
import type { MessagingBackend } from './types.js';

/** Options for {@link createMemoryBackend}. */
export interface MemoryBackendOptions {
  /** Hex public key reported as `ownerPubkey` and used as the sender of outgoing messages. Defaults to `'owner'`. */
  readonly owner?: string;
  /** Whether `status()` reports the backend as available. Sends are refused while it is not. Defaults to `true`. */
  readonly available?: boolean;
  /** Clock in Unix seconds, for deterministic tests. Defaults to the wall clock. */
  readonly now?: () => number;
}

/** An incoming message injected with {@link MemoryBackend.deliver}. */
export interface MemoryIncoming {
  /** Target conversation. Defaults to the direct conversation with `senderPubkey`. */
  readonly conversationId?: string;
  readonly senderPubkey: string;
  readonly content: string;
  /** Unix seconds. Defaults to the backend clock. */
  readonly createdAt?: number;
}

/** The in-memory backend, with a hook for simulating the other side of a conversation. */
export interface MemoryBackend extends MessagingBackend {
  /**
   * Store a message as if a correspondent had sent it, mark it unread and
   * notify matching subscribers.
   *
   * @param incoming - Sender, content and optional conversation.
   * @returns The stored message with status `received`.
   */
  deliver(incoming: MemoryIncoming): DmMessage;
  close(): void;
}

interface Subscriber {
  readonly conversationId?: string;
  readonly onMessage: (message: DmMessage) => void;
}

interface Thread {
  readonly participants: DmPeer[];
  readonly messages: DmMessage[];
}

const DEFAULT_CONVERSATION_LIMIT = 50;
const DEFAULT_MESSAGE_LIMIT = 100;

function conversationIdFor(others: readonly string[]): string {
  const sorted = [...new Set(others)].sort();
  return `${sorted.length > 1 ? 'group' : 'direct'}:${sorted.join(',')}`;
}

function latestActivity(entry: Thread): number {
  return Math.max(...entry.messages.map((message) => message.createdAt));
}

function offsetOf(cursor: string | undefined): number {
  return cursor === undefined ? 0 : Number.parseInt(cursor, 10) || 0;
}

function page<T>(items: readonly T[], cursor: string | undefined, limit: number): { items: T[]; cursor?: string } {
  const offset = offsetOf(cursor);
  const slice = items.slice(offset, offset + limit);
  const end = offset + slice.length;
  return { items: slice, ...(end < items.length ? { cursor: String(end) } : {}) };
}

/**
 * A complete `MessagingBackend` that lives in memory.
 *
 * Used by the shell's offline preview and by tests. Conversations are keyed
 * `direct:<pubkey>` or `group:<pubkey>,<pubkey>` over the sorted correspondents.
 * `send()` stores the message as `sent`, notifies subscribers and returns it;
 * `deliver()` plays the other side. Unread counts are the number of `received`
 * messages in a conversation. Cursors are numeric offsets.
 *
 * `send()` rejects with `invalid:no-recipients` when neither a conversation nor
 * a recipient is named, with `invalid:unknown-conversation` for an id the
 * backend has never seen, and with `unavailable:offline` while `available` is
 * false. Reads keep working offline so a preview can still show history.
 *
 * @param options - Owner key, availability and clock.
 * @returns A backend that also exposes `deliver()`.
 * @example
 * ```ts
 * const backend = createMemoryBackend({ owner: 'me', now: () => 1_700_000_000 });
 * await backend.send({ recipients: ['alice'], content: 'hi' });
 * backend.deliver({ senderPubkey: 'alice', content: 'hello' });
 * (await backend.conversations()).conversations[0];
 * // { id: 'direct:alice', kind: 'direct', participants: [{ pubkey: 'alice' }], unread: 1, updatedAt: 1700000000 }
 * ```
 */
export function createMemoryBackend(options: MemoryBackendOptions = {}): MemoryBackend {
  const owner = options.owner ?? 'owner';
  const available = options.available ?? true;
  const now = options.now ?? ((): number => Math.floor(Date.now() / 1000));
  const threads = new Map<string, Thread>();
  const subscribers = new Map<string, Subscriber>();
  let messageCount = 0;
  let subscriptionCount = 0;

  const thread = (conversationId: string, others: readonly string[]): Thread => {
    const existing = threads.get(conversationId);
    if (existing) return existing;
    const created: Thread = { participants: [...new Set(others)].sort().map((pubkey) => ({ pubkey })), messages: [] };
    threads.set(conversationId, created);
    return created;
  };

  const store = (conversationId: string, others: readonly string[], message: Omit<DmMessage, 'id' | 'conversationId'>, id?: string): DmMessage => {
    messageCount += 1;
    const stored: DmMessage = { ...message, id: id ?? `msg-${messageCount}`, conversationId };
    thread(conversationId, others).messages.push(stored);
    for (const subscriber of subscribers.values()) {
      if (subscriber.conversationId === undefined || subscriber.conversationId === conversationId) subscriber.onMessage(stored);
    }
    return stored;
  };

  const summarize = (id: string, entry: Thread): DmConversation => ({
    id,
    kind: entry.participants.length > 1 ? 'group' : 'direct',
    participants: entry.participants,
    unread: entry.messages.filter((message) => message.status === 'received').length,
    updatedAt: latestActivity(entry),
  });

  const targetOf = (request: DmSendRequest): string => {
    if (request.conversationId !== undefined) {
      if (!threads.has(request.conversationId)) throw new Error('invalid:unknown-conversation');
      return request.conversationId;
    }
    const others = request.recipients.filter((pubkey) => pubkey !== owner);
    if (others.length === 0) throw new Error('invalid:no-recipients');
    return conversationIdFor(others);
  };

  return {
    status(): DmStatus {
      return { available, ownerPubkey: owner, implementations: ['memory'], capabilities: ['send', 'receive', 'subscribe', 'history'] };
    },
    conversations(query: DmConversationQuery = {}): DmConversationPage {
      const all = [...threads]
        .sort(([, a], [, b]) => latestActivity(b) - latestActivity(a))
        .map(([id, entry]) => summarize(id, entry));
      const result = page(all, query.cursor, query.limit ?? DEFAULT_CONVERSATION_LIMIT);
      return { conversations: result.items, ...(result.cursor === undefined ? {} : { cursor: result.cursor }) };
    },
    messages(query: DmMessageQuery): DmMessagePage {
      const all = threads.get(query.conversationId)?.messages ?? [];
      const result = page(all, query.cursor, query.limit ?? DEFAULT_MESSAGE_LIMIT);
      return { messages: result.items, ...(result.cursor === undefined ? {} : { cursor: result.cursor }) };
    },
    async send(request: DmSendRequest): Promise<DmSendResult> {
      if (!available) throw new Error('unavailable:offline');
      const conversationId = targetOf(request);
      const message = store(
        conversationId,
        request.recipients.filter((pubkey) => pubkey !== owner),
        { senderPubkey: owner, createdAt: now(), content: request.content, status: 'sent' },
        request.clientMessageId,
      );
      return { ok: true, message };
    },
    deliver(incoming: MemoryIncoming): DmMessage {
      const conversationId = incoming.conversationId ?? conversationIdFor([incoming.senderPubkey]);
      return store(conversationId, [incoming.senderPubkey], {
        senderPubkey: incoming.senderPubkey,
        createdAt: incoming.createdAt ?? now(),
        content: incoming.content,
        status: 'received',
      });
    },
    subscribe(request: DmSubscribeRequest, onMessage: (message: DmMessage) => void): DmSubscription {
      subscriptionCount += 1;
      const subscriptionId = `memory-${subscriptionCount}`;
      subscribers.set(subscriptionId, {
        ...(request.conversationId === undefined ? {} : { conversationId: request.conversationId }),
        onMessage,
      });
      return { subscriptionId };
    },
    unsubscribe(subscriptionId: string): DmOk {
      return { ok: subscribers.delete(subscriptionId) };
    },
    close(): void {
      subscribers.clear();
    },
  };
}
