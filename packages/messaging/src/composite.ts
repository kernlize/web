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
import { namespaceId, splitId } from './ids.js';
import { directPeerOf, lastProviderOf } from './reply.js';
import type { MessagingBackend } from './types.js';

/** One enabled provider as the composite sees it. */
export interface EnabledBackend {
  readonly id: string;
  readonly backend: MessagingBackend;
}

/**
 * A request that may name the provider to use. The NAP `dm` wire types carry
 * no provider field; the shell adds one when the user picks a provider for a
 * new conversation.
 */
export type WithProvider<T> = T & { readonly provider?: string };

/** A one-to-one message about to leave through a provider the correspondent did not last use. */
export interface ReplyChoice {
  readonly peer: DmPeer;
  /** The provider the correspondent last wrote through. */
  readonly theirs: string;
  /** The provider the message is planned for. */
  readonly mine: string;
}

/** Options for {@link createCompositeBackend}. */
export interface CompositeOptions {
  /**
   * Called before a one-to-one send whose planned provider differs from the one the correspondent
   * last wrote through. Resolves the provider id to use; a rejection stops the send. Without it
   * the planned provider is used.
   */
  readonly chooseReply?: (choice: ReplyChoice) => Promise<string> | string;
}

const NOT_READY = 'unavailable:recipient-not-ready';

interface SubscriptionPart {
  readonly providerId: string;
  readonly subscriptionId: string;
}

function unknownProvider(): Error {
  return new Error('invalid:unknown-provider');
}

function prefixMessage(providerId: string, message: DmMessage): DmMessage {
  return {
    ...message,
    id: namespaceId(providerId, message.id),
    conversationId: namespaceId(providerId, message.conversationId),
  };
}

function prefixConversation(providerId: string, conversation: DmConversation): DmConversation {
  return { ...conversation, id: namespaceId(providerId, conversation.id) };
}

function mergeStatus(statuses: readonly DmStatus[]): DmStatus {
  const owner = statuses.find((status) => status.ownerPubkey !== undefined)?.ownerPubkey;
  return {
    available: statuses.some((status) => status.available),
    ...(owner === undefined ? {} : { ownerPubkey: owner }),
    implementations: [...new Set(statuses.flatMap((status) => status.implementations))],
    capabilities: [...new Set(statuses.flatMap((status) => status.capabilities))],
  };
}

function byRecentActivity(a: DmConversation, b: DmConversation): number {
  return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
}

/**
 * Build one `MessagingBackend` that spans every enabled provider.
 *
 * Conversation and message ids leaving the composite are namespaced as
 * `"<providerId>:<innerId>"`; ids arriving from callers are split on the first
 * `:` to find the provider. Pagination cursors for `conversations()` are
 * namespaced the same way and are only produced when exactly one provider is
 * involved; with several providers the merged page carries no cursor, because
 * no single provider can resume it.
 *
 * A send that names a conversation goes to that conversation's provider. A send
 * that names only recipients goes to the default; when that provider answers
 * `unavailable:recipient-not-ready` the next enabled one is tried, in order, and
 * the first refusal is reported when none can reach the person. Before a
 * one-to-one send leaves, the composite looks up which provider the
 * correspondent last wrote through; when it is not the planned one,
 * `options.chooseReply` decides, and a message moved to their provider is sent
 * to the person, not into the conversation that was named. A send that names a
 * `provider` is never second-guessed.
 *
 * `close()` is a no-op: the registry that enabled the backends owns their
 * lifetime and closes them through `MessagingRegistry.close()`. Unsubscribing
 * a composite subscription skips providers that were disabled in the meantime,
 * since disabling already closed their backend.
 *
 * @param resolveEnabled - Returns the currently enabled providers, in the user's order.
 * @param getDefault - Returns the id of the provider used for sends that name none.
 * @param options - The hook that settles a reply through another provider.
 * @returns A backend suitable for `createDmService`.
 * @example
 * ```ts
 * const dm = createCompositeBackend(
 *   () => [{ id: 'private', backend: privateBackend }],
 *   () => 'private',
 * );
 * const page = await dm.conversations({ limit: 20 });
 * page.conversations[0]?.id; // 'private:direct:ab,cd'
 * ```
 */
export function createCompositeBackend(
  resolveEnabled: () => readonly EnabledBackend[],
  getDefault: () => string | undefined,
  options: CompositeOptions = {},
): MessagingBackend {
  const subscriptions = new Map<string, readonly SubscriptionPart[]>();
  let subscriptionCount = 0;

  const resolve = (providerId: string): EnabledBackend => {
    const found = resolveEnabled().find((entry) => entry.id === providerId);
    if (!found) throw unknownProvider();
    return found;
  };

  const route = (compositeId: string): EnabledBackend & { innerId: string } => {
    const parts = splitId(compositeId);
    if (!parts) throw unknownProvider();
    return { ...resolve(parts.providerId), innerId: parts.innerId };
  };

  const pageFrom = async (entry: EnabledBackend, query: DmConversationQuery): Promise<DmConversationPage> => {
    const page = await entry.backend.conversations(query);
    return {
      conversations: page.conversations.map((conversation) => prefixConversation(entry.id, conversation)),
      ...(page.cursor === undefined ? {} : { cursor: namespaceId(entry.id, page.cursor) }),
    };
  };

  const conversations = async (query: DmConversationQuery = {}): Promise<DmConversationPage> => {
    if (query.cursor !== undefined) {
      const target = route(query.cursor);
      return pageFrom(target, { ...query, cursor: target.innerId });
    }
    const enabled = resolveEnabled();
    const single = enabled.length === 1 ? enabled[0] : undefined;
    if (single) return pageFrom(single, query);
    const pages = await Promise.all(enabled.map((entry) => pageFrom(entry, query)));
    const merged = pages.flatMap((page) => page.conversations).sort(byRecentActivity);
    return { conversations: query.limit === undefined ? merged : merged.slice(0, query.limit) };
  };

  const deliver = async (entry: EnabledBackend, request: DmSendRequest): Promise<DmSendResult> => {
    const result = await entry.backend.send(request);
    return { ...result, message: prefixMessage(entry.id, result.message) };
  };

  /** The provider a one-to-one message should use: the planned one unless the correspondent last wrote through another and the host says to follow. */
  const settle = async (planned: string, peer: DmPeer | undefined): Promise<string> => {
    const enabled = resolveEnabled();
    if (!peer || !options.chooseReply || enabled.length < 2) return planned;
    const theirs = await lastProviderOf(enabled, peer.pubkey);
    return theirs === undefined || theirs === planned ? planned : options.chooseReply({ peer, theirs, mine: planned });
  };

  const toPerson = (request: DmSendRequest, pubkey: string): DmSendRequest => ({
    recipients: [pubkey],
    content: request.content,
    ...(request.clientMessageId === undefined ? {} : { clientMessageId: request.clientMessageId }),
  });

  const sendInto = async (request: DmSendRequest, conversationId: string): Promise<DmSendResult> => {
    const target = route(conversationId);
    const peer = await directPeerOf(target.backend, target.innerId);
    const chosen = await settle(target.id, peer);
    if (peer && chosen !== target.id) return deliver(resolve(chosen), toPerson(request, peer.pubkey));
    return deliver(target, { ...request, conversationId: target.innerId });
  };

  const solePeer = async (recipients: readonly string[], entry: EnabledBackend): Promise<DmPeer | undefined> => {
    const owner = (await entry.backend.status()).ownerPubkey;
    const others = [...new Set(recipients)].filter((pubkey) => pubkey !== owner);
    return others.length === 1 ? { pubkey: others[0] as string } : undefined;
  };

  const sendNew = async (request: DmSendRequest): Promise<DmSendResult> => {
    const enabled = resolveEnabled();
    const fallback = getDefault();
    const start = fallback === undefined ? -1 : enabled.findIndex((item) => item.id === fallback);
    const first = enabled[start];
    if (!first) throw new Error('unavailable:no-default-provider');
    const chosen = await settle(first.id, await solePeer(request.recipients, first));
    if (chosen !== first.id) return deliver(resolve(chosen), request);
    let refusal: unknown;
    for (const entry of enabled.slice(start)) {
      try {
        return await deliver(entry, request);
      } catch (error) {
        if (!String((error as Error).message).startsWith(NOT_READY)) throw error;
        refusal ??= error;
      }
    }
    throw refusal;
  };

  const subscribeOn = async (
    entry: EnabledBackend,
    request: DmSubscribeRequest | { innerId: string },
    onMessage: (message: DmMessage) => void,
  ): Promise<SubscriptionPart> => {
    const inner = 'innerId' in request ? { conversationId: request.innerId } : request;
    const sub = await entry.backend.subscribe(inner, (message) => onMessage(prefixMessage(entry.id, message)));
    return { providerId: entry.id, subscriptionId: sub.subscriptionId };
  };

  return {
    async status(): Promise<DmStatus> {
      const statuses = await Promise.all(resolveEnabled().map((entry) => entry.backend.status()));
      return mergeStatus(statuses);
    },
    conversations,
    async messages(query: DmMessageQuery): Promise<DmMessagePage> {
      const target = route(query.conversationId);
      const page = await target.backend.messages({ ...query, conversationId: target.innerId });
      return { ...page, messages: page.messages.map((message) => prefixMessage(target.id, message)) };
    },
    async send(request: WithProvider<DmSendRequest>): Promise<DmSendResult> {
      const { provider, ...plain } = request;
      if (plain.conversationId !== undefined) return sendInto(plain, plain.conversationId);
      if (provider !== undefined) return deliver(resolve(provider), plain);
      return sendNew(plain);
    },
    async subscribe(request: DmSubscribeRequest, onMessage: (message: DmMessage) => void): Promise<DmSubscription> {
      const target = request.conversationId === undefined ? undefined : route(request.conversationId);
      const parts = target
        ? [await subscribeOn(target, target, onMessage)]
        : await Promise.all(resolveEnabled().map((entry) => subscribeOn(entry, request, onMessage)));
      subscriptionCount += 1;
      const subscriptionId = `composite-${subscriptionCount}`;
      subscriptions.set(subscriptionId, parts);
      return { subscriptionId };
    },
    async unsubscribe(subscriptionId: string): Promise<DmOk> {
      const parts = subscriptions.get(subscriptionId);
      if (!parts) return { ok: false };
      subscriptions.delete(subscriptionId);
      const enabled = resolveEnabled();
      const live = parts.flatMap((part) => {
        const entry = enabled.find((item) => item.id === part.providerId);
        return entry ? [entry.backend.unsubscribe(part.subscriptionId)] : [];
      });
      const results = await Promise.all(live);
      return { ok: results.every((result) => result.ok) };
    },
    close(): void {},
  };
}
