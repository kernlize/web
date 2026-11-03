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
      'kehto',
      'Applets cannot reach the network on their own',
      'Every applet runs in a sealed frame with no direct network access. Anything it sends or receives goes through the shell, where you can see it, slow it down or stop it.',
    ),
    mitigation(
      'bound-identity',
      'kehto',
      'An applet is only trusted while its connection and code match',
      "The shell ties each applet's grants to the exact code it verified and the live connection it opened. If either changes, the grants end immediately.",
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
      'Replayed messages are dropped',
      'Messages an applet has already sent, or messages that arrive from the wrong window, are ignored instead of acted on twice.',
    ),
    mitigation(
      'rate-limits',
      'both',
      'Applets have a budget for how often they can act',
      'Reading, publishing, deleting, messaging and storage each have their own allowance. An applet that spends its allowance is paused until it refills.',
      `publish ${perWindow(rates['relay:publish'])}, delete ${perWindow(rates['relay:publish:delete'])}, messages ${perWindow(rates['dm:send'])}`,
    ),
    mitigation(
      'focus-tightening',
      'kernl',
      'Applets you are not using get a smaller budget',
      'When an applet window is not the one you are working in, its allowance shrinks. An applet never loses its budget entirely just for being in the background.',
      `${limits.unfocusedMultiplier * 100}% of the focused budget`,
    ),
    mitigation(
      'hidden-deferral',
      'kernl',
      'Hidden applets wait their turn',
      'Requests from a minimised or hidden applet are held until you bring it back, apart from the small messages that keep its window working.',
      `${limits.deferQueue} held requests, ${limits.hiddenResourceAllowance} downloads while hidden`,
    ),
    mitigation(
      'ingress-flood',
      'kernl',
      'Applets that flood the shell are put in quarantine',
      'Bursts of messages are queued rather than processed at once. An applet that keeps flooding is quarantined until you decide what to do with it.',
      `${limits.ingressBurst} messages per second, ${limits.quarantineThreshold} per 10s`,
    ),
    mitigation(
      'size-caps',
      'both',
      'Oversized requests are refused',
      'Downloads and long-running queries have a maximum request size, so an applet cannot exhaust memory with one message.',
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
      'both',
      'Deleting or overwriting asks you first',
      'Before an applet removes or replaces something in your account, the shell shows you what would change and waits for your answer.',
    ),
  ];
}
