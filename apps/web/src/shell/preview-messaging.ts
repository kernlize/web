import {
  createGroupMessagesProvider,
  createLegacyMessagesProvider,
  createMemoryBackend,
  createMessagingRegistry,
  createPrivateMessagesProvider,
  createRatchetMessagesProvider,
  type MemoryBackend,
  type MessagingRegistry,
  type MessagingRegistryOptions,
  type SavedMessagingPreferences,
} from '@kernlize/messaging';
import type { StorageLike } from './contract';

const PREFERENCES_KEY = 'kernl:preview:messaging:v1';
const ADA = 'c21d7e4f9a0b3c6d8e1f2a5b7c9d0e3f4a6b8c1d2e5f7a9b0c3d6e8f1a4b7c9d';
const GRACE = '5b8e2f1a7c4d9e0b3a6f8c1d4e7b0a3f6c9d2e5b8a1f4c7d0e3b6a9f2c5d8e1b';
const NAMES: Readonly<Record<string, string>> = { [ADA]: 'Ada', [GRACE]: 'Grace' };
const REPLY_DELAY_MS = 900;

/** Someone who already wrote to the preview account through one provider. */
interface Correspondent {
  readonly pubkey: string;
  /** How long ago their first line arrived, in seconds; each later line follows a minute after. */
  readonly agoSeconds: number;
  readonly lines: readonly string[];
}

const ADA_OPENS: Correspondent = {
  pubkey: ADA,
  agoSeconds: 600,
  lines: ['Hi. This conversation lives in the preview only; nothing leaves your browser.', 'Try sending something. I reply after a moment, like a correspondent would.'],
};

/** Grace writes through the second provider in the default order, so answering her shows the reply question. */
const GRACE_OPENS: Correspondent = {
  pubkey: GRACE,
  agoSeconds: 7200,
  lines: ['I still write the old way. Answer me and the shell asks how your reply should travel.'],
};

const REPLIES = [
  'Got it. That arrived the way you sent it.',
  'Your providers and their order are under Settings, Messages. The first one that is switched on is used first.',
  'When someone last wrote to you another way, the shell asks before it answers for you.',
  'Nothing here is ranked. The properties are stated and you decide.',
];

const DEFAULTS: SavedMessagingPreferences = { enabled: ['private', 'legacy'] };

function loadPreferences(storage: StorageLike): SavedMessagingPreferences {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as SavedMessagingPreferences).enabled)) return parsed as SavedMessagingPreferences;
  } catch {
    // Fall through to the defaults.
  }
  return DEFAULTS;
}

/**
 * Wrap a memory backend so the people the preview knows have names, one of them has already
 * written, and every send is answered by a scripted correspondent.
 */
function scripted(backend: MemoryBackend, owner: string, opens: Correspondent, now: () => number): MemoryBackend {
  let replyIndex = 0;
  opens.lines.forEach((content, index) => backend.deliver({ senderPubkey: opens.pubkey, content, createdAt: now() - opens.agoSeconds + index * 60 }));
  const named = (peer: { readonly pubkey: string }): { pubkey: string; label?: string } => {
    const label = NAMES[peer.pubkey];
    return label === undefined ? { pubkey: peer.pubkey } : { pubkey: peer.pubkey, label };
  };
  return {
    ...backend,
    async conversations(query) {
      const page = await backend.conversations(query);
      return { ...page, conversations: page.conversations.map((conversation) => ({ ...conversation, participants: conversation.participants.map(named) })) };
    },
    async send(request) {
      const result = await backend.send(request);
      const correspondent = request.recipients.find((pubkey) => pubkey !== owner) ?? opens.pubkey;
      const conversationId = result.message.conversationId;
      setTimeout(() => {
        backend.deliver({ conversationId, senderPubkey: correspondent, content: REPLIES[replyIndex % REPLIES.length]! });
        replyIndex += 1;
      }, REPLY_DELAY_MS);
      return result;
    },
  };
}

/**
 * The preview's registry: the real registry and the real provider definitions
 * over in-memory backends. Two providers start switched on, each with someone
 * who already wrote through it, so the order and the reply question can both be
 * tried. The group provider asks for a signed-in account,
 * which the preview has none of, and the ratchet provider is registered and reports
 * itself unavailable, which is the truth in a browser without its runtime.
 */
export function createPreviewMessaging(storage: StorageLike, owner: string, askReply?: MessagingRegistryOptions['askReply']): MessagingRegistry {
  const now = (): number => Math.floor(Date.now() / 1000);
  const registry = createMessagingRegistry({
    preferences: loadPreferences(storage),
    onChange: (preferences) => storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)),
    ...(askReply ? { askReply } : {}),
  });
  const available = (): { available: true } => ({ available: true });
  registry.register(
    createPrivateMessagesProvider({
      createBackend: () => scripted(createMemoryBackend({ owner, now }), owner, ADA_OPENS, now),
      available,
    }),
  );
  registry.register(
    createLegacyMessagesProvider({
      createBackend: () => scripted(createMemoryBackend({ owner, now }), owner, GRACE_OPENS, now),
      available,
    }),
  );
  registry.register(
    createRatchetMessagesProvider({
      createBackend: () => createMemoryBackend({ owner, now, available: false }),
      available: () => ({ available: false, reason: 'no-ratchet-runtime' }),
    }),
  );
  registry.register(
    createGroupMessagesProvider({
      createBackend: () => createMemoryBackend({ owner, now, available: false }),
      available: () => ({ available: false, reason: 'sign-in-required' }),
    }),
  );
  return registry;
}

/** The two people who have already written to the preview account, and the provider each used. */
export const PREVIEW_CORRESPONDENT = ADA;
export const PREVIEW_LEGACY_CORRESPONDENT = GRACE;
