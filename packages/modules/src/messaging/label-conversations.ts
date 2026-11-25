import type { DmAdapter } from '@kehto/services';
import type { DmConversation } from '@napplet/core';
import type { Profiles } from '../profiles/profiles.js';

/**
 * Name the people in every conversation the shell lists for an applet.
 *
 * A messaging backend knows keys; a person knows names. Each participant
 * without a label is given the name from their published profile, read from
 * the store or cache at once and otherwise looked up until it is found or
 * every lookup server has answered. A participant with no profile keeps no
 * label, so the applet still shows its own short form. A label the backend
 * already gave is kept: it is how that provider names the person (D-031).
 *
 * @param adapter - The composite messaging adapter kehto's `dm` service routes to.
 * @param profiles - The shell's profile service.
 * @returns The same adapter with participants named.
 * @example
 * ```ts
 * createDmService({ adapter: labelConversations(messaging.composite(), kernl.profiles) });
 * ```
 */
export function labelConversations(adapter: DmAdapter, profiles: Pick<Profiles, 'settled'>): DmAdapter {
  const named = async (conversation: DmConversation): Promise<DmConversation> => {
    const participants = await Promise.all(
      conversation.participants.map(async (peer) => {
        if (peer.label) return peer;
        const card = await profiles.settled(peer.pubkey);
        return card.found ? { ...peer, label: card.name } : peer;
      }),
    );
    return { ...conversation, participants };
  };
  return {
    ...adapter,
    async conversations(query) {
      const page = await adapter.conversations(query);
      return { ...page, conversations: await Promise.all(page.conversations.map(named)) };
    },
  };
}
