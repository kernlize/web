import {
  createGroupMessagesProvider,
  createLegacyMessagesProvider,
  createMemoryBackend,
  createMessagingRegistry,
  createPrivateMessagesProvider,
  createRatchetMessagesProvider,
  type MemoryBackend,
  type MessagingPreferences,
  type MessagingRegistry,
} from '@kernlize/messaging';
import type { StorageLike } from './contract';

const PREFERENCES_KEY = 'kernl:preview:messaging:v1';
const ADA = 'c21d7e4f9a0b3c6d8e1f2a5b7c9d0e3f4a6b8c1d2e5f7a9b0c3d6e8f1a4b7c9d';
const REPLY_DELAY_MS = 900;

const OPENERS = [
  'Hi. This conversation lives in the preview only; nothing leaves your browser.',
  'Try sending something. I reply after a moment, like a correspondent would.',
];

const REPLIES = [
  'Got it. Which provider did that come through?',
  'The shell shows the provider on each thread, so you always know who could read what.',
  'Switching providers is yours to do; the shell does not pick for you.',
  'Nothing here is ranked. The properties are stated and you decide.',
];

function loadPreferences(storage: StorageLike): MessagingPreferences {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? 'null');
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as MessagingPreferences).enabled)) return parsed as MessagingPreferences;
  } catch {
    // Fall through to the defaults.
  }
  return { enabled: ['private'], defaultProvider: 'private' };
}

/** Wrap a memory backend so every send is answered by a scripted correspondent. */
function scripted(backend: MemoryBackend, owner: string, seed: boolean, now: () => number): MemoryBackend {
  let replyIndex = 0;
  if (seed) {
    OPENERS.forEach((content, index) => backend.deliver({ senderPubkey: ADA, content, createdAt: now() - 600 + index * 60 }));
  }
  return {
    ...backend,
    async send(request) {
      const result = await backend.send(request);
      const correspondent = request.recipients.find((pubkey) => pubkey !== owner) ?? ADA;
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
 * over in-memory backends. The group provider asks for a signed-in account,
 * which the preview has none of, and the ratchet provider is registered and reports
 * itself unavailable, which is the truth in a browser without its runtime.
 */
export function createPreviewMessaging(storage: StorageLike, owner: string): MessagingRegistry {
  const now = (): number => Math.floor(Date.now() / 1000);
  const registry = createMessagingRegistry({
    preferences: loadPreferences(storage),
    onChange: (preferences) => storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)),
  });
  const available = (): { available: true } => ({ available: true });
  registry.register(
    createPrivateMessagesProvider({
      createBackend: () => scripted(createMemoryBackend({ owner, now }), owner, true, now),
      available,
    }),
  );
  registry.register(
    createLegacyMessagesProvider({
      createBackend: () => scripted(createMemoryBackend({ owner, now }), owner, false, now),
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

/** The scripted correspondent's account id, so the compose box can suggest it. */
export const PREVIEW_CORRESPONDENT = ADA;
