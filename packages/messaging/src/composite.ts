import type {
  DmConversation,
  DmConversationPage,
  DmConversationQuery,
  DmMessage,
  DmMessagePage,
  DmMessageQuery,
  DmOk,
  DmSendRequest,
  DmSendResult,
  DmStatus,
  DmSubscribeRequest,
  DmSubscription,
} from '@napplet/core';
import { namespaceId, splitId } from './ids.js';
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
 * `close()` is a no-op: the registry that enabled the backends owns their
 * lifetime and closes them through `MessagingRegistry.close()`. Unsubscribing
 * a composite subscription skips providers that were disabled in the meantime,
 * since disabling already closed their backend.
 *
 * @param resolveEnabled - Returns the currently enabled providers, in order.
 * @param getDefault - Returns the id of the provider used for sends that name none.
 * @returns A backend suitable for `createDmService`.
 * @example
 * const dm = createCompositeBackend(
 *   () => [{ id: 'private', backend: privateBackend }],
 *   () => 'private',
 * );
 * const page = await dm.conversations({ limit: 20 });
 * page.conversations[0]?.id; // 'private:direct:ab,cd'
 */
export function createCompositeBackend(
  resolveEnabled: () => readonly EnabledBackend[],
  getDefault: () => string | undefined,
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

  const chooseSender = (request: WithProvider<DmSendRequest>): EnabledBackend & { request: DmSendRequest } => {
    const { provider, ...plain } = request;
    if (plain.conversationId !== undefined) {
      const target = route(plain.conversationId);
      return { ...target, request: { ...plain, conversationId: target.innerId } };
    }
    if (provider !== undefined) return { ...resolve(provider), request: plain };
    const fallback = getDefault();
    const entry = fallback === undefined ? undefined : resolveEnabled().find((item) => item.id === fallback);
    if (!entry) throw new Error('unavailable:no-default-provider');
    return { ...entry, request: plain };
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
      const target = chooseSender(request);
      const result = await target.backend.send(target.request);
      return { ...result, message: prefixMessage(target.id, result.message) };
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
