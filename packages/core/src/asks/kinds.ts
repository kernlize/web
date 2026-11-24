import type { PermissionRequirement } from '@kehto/runtime';
import type { ReplyAnswer, ReplyPrompt } from '@kernlize/messaging';
import type { NostrEvent } from 'applesauce-core/helpers';
import type { SettingsPrompt } from '../applets/applet-config.js';
import type { DownloadQuestion } from '../downloads/types.js';
import type { UploadDetails } from '../files/uploader.js';
import type { AppletIdentity, ConsentSummary, FirewallChoice, FirewallSummary, HandlerChoice, HandlerPrompt } from '../types.js';

/**
 * Every question the kernel puts to the person, by kind: the facts the host receives, kernl's own
 * wording, and the answer it gives back (D-067). A host draws each kind it registers in
 * `KernlHost.asks`; one it does not register is refused.
 */
export interface AskKinds {
  /** Signing a write an applet asked for that replaces or erases part of the person's record. */
  readonly 'sign.replace': { readonly facts: { readonly draft: NostrEvent; readonly before?: NostrEvent }; readonly text: ConsentSummary; readonly answer: boolean };
  /** Putting a file an applet chose on the person's file servers. */
  readonly 'upload.file': { readonly facts: UploadDetails; readonly text: ConsentSummary; readonly answer: boolean };
  /** A download program acting for an applet. The question is words only: no address, path or credential. */
  readonly 'download.add': { readonly facts: { readonly question: DownloadQuestion; readonly exposesAddress: boolean }; readonly text: ConsentSummary; readonly answer: boolean };
  /** A direct session with other people, who learn the person's network address. */
  readonly 'connection.direct': { readonly facts: { readonly requirements: readonly PermissionRequirement[] }; readonly text: ConsentSummary; readonly answer: boolean };
  /** A request a firewall rule says to ask about, such as opening a link. `undefined` dismisses it, and with no renderer it is refused (D-056). Withdrawn after ten minutes. */
  readonly 'firewall.approve': { readonly facts: FirewallSummary; readonly text: { readonly title: string }; readonly answer: FirewallChoice | undefined };
  /** Which applet takes a request one applet made of another. `undefined` cancels it; with no renderer kehto refuses a request no default settles. */
  readonly 'intent.choose-handler': { readonly facts: HandlerPrompt; readonly text: { readonly title: string }; readonly answer: HandlerChoice | undefined };
  /** Which provider carries a reply to someone who wrote through another. `undefined` dismisses it, which stops the send; with no renderer the order picks. */
  readonly 'messaging.choose-reply': { readonly facts: ReplyPrompt; readonly text: { readonly title: string }; readonly answer: ReplyAnswer | undefined };
  /** An applet's settings form. It asks nothing back; without a renderer the `config` domain is not offered (D-036). */
  readonly 'settings.present': { readonly facts: SettingsPrompt; readonly text: { readonly title: string }; readonly answer: void };
}

/** The name of an ask kind. */
export type AskKind = keyof AskKinds;

/** The answer a kind's renderer gives. */
export type AskAnswer<K extends AskKind> = AskKinds[K]['answer'];

/** What `Ask.signal` is: aborted when the question is withdrawn. Only the firewall's questions are withdrawn. */
export interface AskSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** One question to the person: who asks, the facts, and kernl's own wording, which a host may reword. */
export interface Ask<K extends AskKind = AskKind> {
  readonly kind: K;
  /** The window that asked. The answer applies to it only, and is discarded once it has closed. */
  readonly windowId?: string;
  /** The exact applet that asked, by name and hash. */
  readonly applet?: AppletIdentity;
  readonly facts: AskKinds[K]['facts'];
  readonly defaultText: AskKinds[K]['text'];
  /** Aborts when the question is withdrawn; close the prompt then. */
  readonly signal?: AskSignal;
}

/** Draws one kind of question and resolves with the person's answer. */
export type AskRenderer<K extends AskKind> = (ask: Ask<K>) => AskAnswer<K> | Promise<AskAnswer<K>>;

/** The renderers a host registers, one per kind it draws. */
export type AskRenderers = { readonly [K in AskKind]?: AskRenderer<K> };

/**
 * Every ask kind, in a fixed order.
 *
 * @example
 * ```ts
 * ASK_KINDS.includes('sign.replace'); // true
 * ```
 */
export const ASK_KINDS: readonly AskKind[] = Object.freeze(['sign.replace', 'upload.file', 'download.add', 'connection.direct', 'firewall.approve', 'intent.choose-handler', 'messaging.choose-reply', 'settings.present']);

/**
 * The answer each kind gets when no renderer draws it, when its renderer fails, or when the window
 * that asked has closed: never an allow (D-067).
 *
 * @example
 * ```ts
 * ASK_REFUSALS['sign.replace']; // false
 * ```
 */
export const ASK_REFUSALS: { readonly [K in AskKind]: AskAnswer<K> } = Object.freeze({
  'sign.replace': false,
  'upload.file': false,
  'download.add': false,
  'connection.direct': false,
  'firewall.approve': undefined,
  'intent.choose-handler': undefined,
  'messaging.choose-reply': undefined,
  'settings.present': undefined,
});
