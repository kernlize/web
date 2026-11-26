import { createMemoryBackend, type MessagingBackend } from '@kernlize/messaging';
import { legacyDm, privateDm, type MessagingProviderModule, type ProviderParts } from '@kernlize/modules';
import type { NostrEvent } from 'applesauce-core/helpers';

/**
 * Ada's and Grace's profiles, signed once with keys that were thrown away, so their names resolve
 * through the real profiles module and nobody can publish as them later.
 */
const ADA_PROFILE: NostrEvent = Object.freeze({
  kind: 0,
  created_at: 1_764_000_000,
  tags: [],
  content: '{"name":"Ada","about":"Writes to you privately in the preview."}',
  pubkey: '319c57825a1ff6fb9c2eaf901df61ca00784aaba12f806e7e681181fae9f4e31',
  id: '6d68801fd63b09179f08fe75d1acfafe44890d1880b41315aea6a2812657a1b6',
  sig: 'c5e25fc94e8dcdd561e9ed72c1cd3e28d6af455a621883ac66d639dd227b8898bd2f66940d077efc3c6086dc2b156c97759f79d28df97091e236f3908a65a666',
});

const GRACE_PROFILE: NostrEvent = Object.freeze({
  kind: 0,
  created_at: 1_764_000_000,
  tags: [],
  content: '{"name":"Grace","about":"Writes to you the older way in the preview."}',
  pubkey: '4b520b24f8fdf5000e7012ce2e80320cb45f2645b2b5d9518fefd0750e9dea19',
  id: 'fe435f411ddca614c658c864a3038787904f46bb6ccac77484fd956c6c0c83e6',
  sig: 'd1b7a794b2fce069266040fcbd4a0cc4dc6507a91b8eb934623b5bc1211193660e2cddbe60a0e1e0b296ac5807a9e54e17e9fdfc63788ef5bc8cfac2a5a4ba95',
});

/**
 * The two people who have already written to the preview's identity: Ada through `private`, Grace through `legacy`.
 *
 * @example
 * ```ts
 * await kernl.messaging.composite().send({ recipients: [PREVIEW_CORRESPONDENTS.ada], content: 'hello' });
 * ```
 */
export const PREVIEW_CORRESPONDENTS: Readonly<{ ada: string; grace: string }> = Object.freeze({ ada: ADA_PROFILE.pubkey, grace: GRACE_PROFILE.pubkey });

/** The profiles the preview seeds for its correspondents. */
export const CORRESPONDENT_PROFILES: readonly NostrEvent[] = Object.freeze([ADA_PROFILE, GRACE_PROFILE]);

/** Someone who already wrote through one provider. */
interface Correspondent {
  readonly pubkey: string;
  /** How long ago their first line arrived, in seconds; each later line follows a minute after. */
  readonly agoSeconds: number;
  readonly lines: readonly string[];
}

const ADA_OPENS: Correspondent = {
  pubkey: ADA_PROFILE.pubkey,
  agoSeconds: 600,
  lines: ['Hi. This conversation lives in the preview only; nothing leaves your browser.', 'Try sending something. I reply after a moment, like a correspondent would.'],
};

/** Grace writes through the second provider in the first-run order, so answering her shows the reply question. */
const GRACE_OPENS: Correspondent = {
  pubkey: GRACE_PROFILE.pubkey,
  agoSeconds: 7200,
  lines: ['I still write the old way. Answer me and the shell asks how your reply should travel.'],
};

/**
 * What a correspondent answers, in turn, to each line the person sends.
 *
 * @example
 * ```ts
 * PREVIEW_REPLIES[0]; // 'Got it. That arrived the way you sent it.'
 * ```
 */
export const PREVIEW_REPLIES: readonly string[] = Object.freeze([
  'Got it. That arrived the way you sent it.',
  'Your providers and their order are under Settings, Messages. The first one that is switched on is used first.',
  'When someone last wrote to you another way, the shell asks before it answers for you.',
  'Nothing here is ranked. The properties are stated and you decide.',
]);

/** How the scripted correspondents keep time. */
export interface CorrespondentClock {
  /** Seconds since the epoch. */
  readonly now: () => number;
  readonly replyDelayMs: number;
}

/**
 * A memory backend owned by the signed-in identity, where `opens` has already written and every
 * send is answered, after a moment, by whoever it went to.
 */
function scripted(parts: ProviderParts, opens: Correspondent, clock: CorrespondentClock): MessagingBackend {
  const owner = parts.selfPubkey() as string;
  const backend = createMemoryBackend({ owner, now: clock.now });
  opens.lines.forEach((content, index) => backend.deliver({ senderPubkey: opens.pubkey, content, createdAt: clock.now() - opens.agoSeconds + index * 60 }));
  let replies = 0;
  return {
    ...backend,
    async send(request) {
      const result = await backend.send(request);
      const correspondent = request.recipients.find((pubkey) => pubkey !== owner) ?? opens.pubkey;
      const reply = PREVIEW_REPLIES[replies % PREVIEW_REPLIES.length] as string;
      replies += 1;
      setTimeout(() => backend.deliver({ conversationId: result.message.conversationId, senderPubkey: correspondent, content: reply }), clock.replyDelayMs);
      return result;
    },
  };
}

/**
 * The `private` and `legacy` providers over memory backends with Ada and Grace in them. The
 * registry builds a backend only once the identity can encrypt, so the owner is known by then.
 *
 * @param clock - The clock the history and replies keep.
 * @returns The two providers, as `messagingModule` takes them.
 */
export function correspondentProviders(clock: CorrespondentClock): readonly MessagingProviderModule[] {
  return [
    { ...privateDm(), backend: (parts) => scripted(parts, ADA_OPENS, clock) },
    { ...legacyDm(), backend: (parts) => scripted(parts, GRACE_OPENS, clock) },
  ];
}
