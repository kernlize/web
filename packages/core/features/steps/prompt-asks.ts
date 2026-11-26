import type { AskRenderers, ConsentPrompt, FirewallPrompt, HandlerChoice, HandlerPrompt, SettingsPrompt } from '@kernlize/core';
import type { ReplyAnswer, ReplyPrompt } from '@kernlize/messaging';

/**
 * Renderers for scenarios that hold a question open and answer it later. Each hands the step a
 * prompt shaped the way the scenario records it, so a step can read the summary and resolve.
 */

/** The four kinds the person answers yes or no to, each drawn as a consent prompt. */
export function consentAsks(present: (prompt: ConsentPrompt) => void): AskRenderers {
  const draw = (ask: { readonly defaultText: ConsentPrompt['summary'] }): Promise<boolean> =>
    new Promise((resolve) => present({ summary: ask.defaultText, resolve }));
  return { 'sign.replace': draw, 'upload.file': draw, 'download.add': draw, 'connection.direct': draw };
}

/** The firewall's question, withdrawn through the ask's signal. */
export function approvalAsks(present: (prompt: FirewallPrompt) => void): AskRenderers {
  return {
    'firewall.approve': (ask) => new Promise((resolve) => present({ summary: ask.facts, signal: ask.signal as FirewallPrompt['signal'], resolve })),
  };
}

/** The chooser for a request several applets can take. */
export function handlerAsks(choose: (prompt: HandlerPrompt) => Promise<HandlerChoice | undefined>): AskRenderers {
  return { 'intent.choose-handler': (ask) => choose(ask.facts) };
}

/** The question about which provider a reply leaves through. */
export function replyAsks(choose: (prompt: ReplyPrompt) => Promise<ReplyAnswer | undefined>): AskRenderers {
  return { 'messaging.choose-reply': (ask) => choose(ask.facts) };
}

/** An applet's settings form. */
export function settingsAsks(present: (prompt: SettingsPrompt) => void): AskRenderers {
  return { 'settings.present': (ask) => present(ask.facts) };
}
