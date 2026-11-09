import type { ReplyAnswer, ReplyPrompt, ReplyRule } from '@kernlize/messaging';
import { abbreviate } from './contract';

/** What the reply question calls the person: the name the shell knows, or a short account id. */
export const peerName = (peer: ReplyPrompt['peer']): string => peer.label ?? abbreviate(peer.pubkey);

/** The sentence that says why the shell is asking. */
export function replyQuestion(prompt: ReplyPrompt): string {
  const name = peerName(prompt.peer);
  return `${name} last wrote to you through ${prompt.theirs.name}. Your order would send this through ${prompt.mine.name}, and ${name} may not see it there.`;
}

/** The three ways to keep an answer, as the question words them for this person. */
export function rememberChoices(prompt: ReplyPrompt): readonly { readonly id: ReplyAnswer['remember']; readonly label: string }[] {
  return [
    { id: 'once', label: 'For this message only' },
    { id: 'conversation', label: `Every time I write to ${peerName(prompt.peer)}` },
    { id: 'always', label: 'Every time, for everyone' },
  ];
}

/** What keeping an answer for everyone turns into, so nobody agrees to a rule they did not read. */
export function alwaysMeans(use: ReplyAnswer['use']): string {
  return use === 'theirs' ? 'The shell will reply through whichever provider the other person last used, without asking.' : 'The shell will always use your order, without asking.';
}

/** The reply rules as Settings lists them. */
export const REPLY_RULES: readonly { readonly id: ReplyRule; readonly label: string; readonly help: string }[] = [
  { id: 'ask', label: 'Ask me', help: 'The shell stops and asks before the message leaves.' },
  { id: 'theirs', label: 'Reply the way they wrote to me', help: 'The reply leaves through the provider the other person last used.' },
  { id: 'mine', label: 'Always use my order', help: 'The reply leaves through the first provider on your list, whatever they used.' },
];

/** How many people the user settled the question for, in words; empty when none. */
export function settledWords(count: number): string {
  if (count === 0) return '';
  return count === 1 ? 'You settled this for one person.' : `You settled this for ${count} people.`;
}

/** A new order with one provider moved a step up or down; unchanged when it is already at that end. */
export function moved(order: readonly string[], id: string, step: -1 | 1): string[] {
  const from = order.indexOf(id);
  const to = from + step;
  if (from === -1 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
