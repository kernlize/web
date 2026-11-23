import type { EventStore } from 'applesauce-core';
import { getProfileContent, unixNow } from 'applesauce-core/helpers';
import type { CommonServiceOptions } from '@kehto/services';
import type { EventTemplate, NostrEvent } from '@napplet/core';
import type { ISigner } from 'applesauce-signers';
import type { SigningConsent } from '../consent/handler.js';
import type { Profiles } from '../profiles/profiles.js';

const FOLLOWS = 3;
const REACTION = 7;
const REPORT = 1984;

/** Signs a template for a window after the person's consent; rejects `denied:read-only` when nobody can sign. */
export type ConsentedSigner = (windowId: string, template: EventTemplate) => Promise<NostrEvent>;

/** The signer and the signing gate apart, as the shell's own composition hands them. */
export interface SignerAndGate {
  /** The account's signer, or none for a read-only session. */
  readonly signer: () => Pick<ISigner, 'signEvent'> | undefined;
  /** The shell's signing gate: destructive changes, such as a new follow list, are put to the person first. */
  readonly consent: SigningConsent;
}

/** What the social actions need from the shell. */
export type CommonActionsOptions = {
  readonly store: EventStore;
  readonly profiles: Pick<Profiles, 'settled'>;
  /** Reads a person from any form of their identity, asking the servers it names first; `invalid:person` otherwise. */
  readonly locate: (input: string) => Promise<string>;
  /** The signed-in account's key, or none. */
  readonly pubkey: () => string | undefined;
  /** Publishes a signed event and resolves how many relays accepted it; rejects when none did (D-028). */
  readonly publish: (event: NostrEvent) => Promise<number>;
  /** Loads the account's current follow list into the store before it is changed. */
  readonly loadFollows: (pubkey: string) => Promise<void>;
} & (SignerAndGate | { /** The kernel's consented signing, as a module is handed it (D-061). */ readonly sign: ConsentedSigner });

/** One way to sign for both forms of the options. */
function signerOf(options: CommonActionsOptions): ConsentedSigner {
  if ('sign' in options) return options.sign;
  return async (windowId, template) => {
    const signer = options.signer();
    if (!signer) throw new Error('denied:read-only');
    await options.consent(windowId, template);
    return (await signer.signEvent(template)) as NostrEvent;
  };
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function followed(event: NostrEvent | undefined): string[] {
  return (event?.tags ?? []).filter((tag) => tag[0] === 'p' && typeof tag[1] === 'string').map((tag) => tag[1] as string);
}

const located = (options: CommonActionsOptions, value: string): Promise<string | undefined> => options.locate(value).catch(() => undefined);

async function signed(options: CommonActionsOptions, windowId: string, template: EventTemplate): Promise<{ ok: true; eventId: string; event: NostrEvent } | { ok: false; error: string }> {
  try {
    const event = await signerOf(options)(windowId, template);
    await options.publish(event);
    options.store.add(event);
    return { ok: true, eventId: event.id, event };
  } catch (error) {
    return { ok: false, error: reasonOf(error) };
  }
}

/** The account's follow list with `pubkeys` added or removed, every other tag and the content kept. */
async function changeFollows(options: CommonActionsOptions, windowId: string, pubkeys: string[], add: boolean) {
  const self = options.pubkey();
  if (!self) return { ok: false, error: 'denied:read-only' };
  const targets = await Promise.all(pubkeys.map((key) => located(options, key)));
  if (targets.some((key) => key === undefined)) return { ok: false, error: 'invalid:pubkey' };
  await options.loadFollows(self);
  const previous = options.store.getReplaceable(FOLLOWS, self);
  const current = followed(previous);
  const next = add ? [...new Set([...current, ...(targets as string[])])] : current.filter((key) => !targets.includes(key));
  const others = (previous?.tags ?? []).filter((tag) => tag[0] !== 'p');
  const tags = [...next.map((key) => ['p', key]), ...others];
  return signed(options, windowId, { kind: FOLLOWS, created_at: Math.max(unixNow(), (previous?.created_at ?? 0) + 1), tags, content: previous?.content ?? '' });
}

/**
 * kernl's NAP-COMMON hooks for kehto's `createCommonService`: profiles and
 * follows to read, and follow, unfollow, react and report to write, all on the
 * person's behalf. Reads are public data. A follow-list change replaces part
 * of the person's public record, so it passes the shell's signing gate and is
 * shown to them as what it changes; reactions and reports are posts. Every
 * write succeeds when any relay accepts it (D-028). A read-only session
 * cannot write (D-035).
 *
 * @param options - Store, profiles, account, signer, signing gate, publisher and follow-list loader.
 * @returns Options for `createCommonService`.
 * @example
 * ```ts
 * registry.common = createCommonService(createCommonActions({ store, profiles, pubkey, signer, consent, publish, loadFollows }));
 * ```
 */
export function createCommonActions(options: CommonActionsOptions): CommonServiceOptions {
  return {
    async getProfile(target) {
      const pubkey = await located(options, target);
      if (!pubkey) return { ok: false, pubkey: '', error: 'invalid:pubkey' };
      const card = await options.profiles.settled(pubkey);
      const event = options.store.getReplaceable(0, pubkey);
      const content = event ? getProfileContent(event) : undefined;
      if (!card.found || !content) return { ok: true, pubkey, profile: null };
      const { display_name: displayName, ...rest } = content;
      return { ok: true, pubkey, profile: { ...rest, ...(displayName ? { displayName } : {}) } };
    },
    async follows() {
      const self = options.pubkey();
      if (!self) return { ok: false, pubkeys: [], error: 'denied:signed-out' };
      await options.loadFollows(self);
      return { ok: true, pubkeys: followed(options.store.getReplaceable(FOLLOWS, self)) };
    },
    follow: (pubkeys, context) => changeFollows(options, context.windowId, pubkeys, true),
    unfollow: (pubkeys, context) => changeFollows(options, context.windowId, pubkeys, false),
    react(targetEventId, reaction, customEmojiHref, context) {
      const target = options.store.getEvent(targetEventId);
      const emoji = customEmojiHref && /^:[\w-]+:$/.test(reaction) ? [['emoji', reaction.slice(1, -1), customEmojiHref]] : [];
      const tags = [['e', targetEventId], ...(target ? [['p', target.pubkey], ['k', String(target.kind)]] : []), ...emoji];
      return signed(options, context.windowId, { kind: REACTION, created_at: unixNow(), tags, content: reaction });
    },
    report(target, reason, text, context) {
      const tags = target.type === 'event' ? [['e', target.id, reason], ...(target.pubkey ? [['p', target.pubkey]] : [])] : [['p', target.pubkey, reason]];
      return signed(options, context.windowId, { kind: REPORT, created_at: unixNow(), tags, content: text });
    },
  };
}
