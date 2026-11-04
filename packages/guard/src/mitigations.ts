import type { GuardConfig, MitigationDescription } from './types.js';

type Provider = MitigationDescription['provider'];

function kib(bytes: number): string {
  return `${bytes / 1024} KiB`;
}

function perWindow(rate: { capacity: number; windowMs: number }): string {
  return `${rate.capacity} per ${rate.windowMs / 1000}s`;
}

function mitigation(id: string, provider: Provider, title: string, summary: string, limit?: string): MitigationDescription {
  return { id, title, summary, enabled: true, provider, ...(limit !== undefined && { limit }) };
}

/**
 * Describe every mitigation between an applet and the user, in plain language.
 *
 * The list is what the grants panel renders (D-003). Titles and summaries
 * avoid protocol vocabulary: they say network, applet and account. Every
 * mitigation is enabled in every profile; only the `limit` text changes.
 * Each summary claims only what is enforced where D-012 places it. kernl
 * sees each request just before the runtime handles it and cannot hold it
 * back, but it can have the runtime refuse that one request: a burst above
 * the per-second rate, a request over the smaller unfocused budget, an
 * oversized request, and any request from a hidden applet other than the
 * messages that keep its window controllable are described as refused.
 * Quarantine closes the applet before the request that crossed the limit is
 * handled, so that request is described as dropped.
 *
 * @param config - The guard configuration whose limits appear in the text.
 * @returns One description per mitigation, in the order the UI shows them.
 * @example
 * ```ts
 * const list = describeMitigations(createGuardConfig('strict'));
 * list.find((m) => m.id === 'ingress-flood')?.limit; // '8 messages per second, 300 per 10s'
 * ```
 */
export function describeMitigations(config: GuardConfig): readonly MitigationDescription[] {
  const { limits } = config;
  const { rates } = limits;
  return [
    mitigation(
      'zero-network-sandbox',
      'both',
      'Applets cannot reach the network on their own',
      'Every applet runs in a sealed frame with no direct network access, and cannot open a frame of its own inside it. Anything it sends or receives goes through the shell, where you can see it, revoke what you granted, or close the applet.',
    ),
    mitigation(
      'bound-identity',
      'kehto',
      'An applet is only trusted while its connection and code match',
      "The shell ties each running applet to the exact code it verified and the live connection it opened. If either changes, the shell closes it at once. Your grants stay with that exact code; changed code starts with none.",
    ),
    mitigation(
      'verified-artifacts',
      'kehto',
      'Applet code is verified before it runs, and again before reuse',
      'Applet code is only accepted when it matches its published fingerprint. Cached copies are checked again every time they are loaded.',
    ),
    mitigation(
      'replay-detection',
      'kehto',
      'Old or repeated posts are not sent',
      'When the shell posts for an applet, it refuses a post it has already sent in the last half minute, one dated too far in the past, or one dated in the future. A message from a window other than the applet’s own is ignored.',
    ),
    mitigation(
      'rate-limits',
      'both',
      'Applets have a budget for how often they can act',
      'Reading, publishing, messaging, storage and downloads each have an allowance, set before the applet starts. A request over its allowance is refused until the allowance refills. Deletions count against publishing, and are also counted on their own so you can see an applet that deletes a lot.',
      `publish ${perWindow(rates['relay:publish'])}, delete ${perWindow(rates['relay:publish:delete'])}, messages ${perWindow(rates['dm:send'])}`,
    ),
    mitigation(
      'focus-tightening',
      'kernl',
      'Applets you are not using are measured against a smaller budget',
      'When an applet window is not the one you are working in, the shell counts its requests against a smaller allowance. A request over it is refused before it is handled, and the shell tells you; the applet can try again once you switch to it. The budget above still applies.',
      `${limits.unfocusedMultiplier * 100}% of the focused budget`,
    ),
    mitigation(
      'hidden-deferral',
      'kernl',
      'Hidden applets cannot act until you can see them',
      'While an applet is minimised or hidden, the shell refuses its requests before they are handled, except the messages that let you close, theme or reach it; the applet can try again once it is visible. One that keeps asking for downloads past its allowance is quarantined: the download that crossed the allowance is dropped, and the shell closes the applet and tells you.',
      `${limits.hiddenResourceAllowance} downloads while hidden`,
    ),
    mitigation(
      'ingress-flood',
      'kernl',
      'Applets that flood the shell are put in quarantine',
      'The shell counts every message an applet sends. Requests in a burst above the per-second rate are refused before they are handled, and the shell tells you; messages that keep the window controllable still get through. An applet that keeps flooding is quarantined: the message that crossed the limit is dropped, and the shell closes the applet and tells you.',
      `${limits.ingressBurst} messages per second, ${limits.quarantineThreshold} per 10s`,
    ),
    mitigation(
      'size-caps',
      'both',
      'Oversized requests are refused',
      'The shell measures download and long-running query requests against a maximum size. One that is too large is refused before it is handled, so nothing it asked for is fetched, and the shell tells you.',
      `downloads ${kib(limits.maxResourceEnvelopeBytes)}, queries ${kib(limits.maxSubscribeEnvelopeBytes)}`,
    ),
    mitigation(
      'device-denial',
      'kehto',
      'Applets cannot use your camera, microphone or other devices',
      'Device and controller access is refused for every applet. There is no grant for it.',
    ),
    mitigation(
      'destructive-consent',
      'kernl',
      'Deleting or overwriting asks you first',
      "Before the shell signs anything for an applet that overwrites or erases part of your account's public record (your profile, contacts, connections, lists or any other record a new version replaces, a deletion, or a request to erase your account), it shows you what changes compared with the current version and waits for your answer. If the current version cannot be loaded, it says so.",
    ),
  ];
}
