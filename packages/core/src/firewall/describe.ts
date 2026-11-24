import type { ApprovalAnswer, ApprovalPrompt, PermissionRequirement } from '@kehto/runtime';
import type { FirewallApplet, FirewallChoice, FirewallRequest, FirewallSummary } from '../types.js';

const ANSWERS: Readonly<Record<FirewallChoice, ApprovalAnswer>> = Object.freeze({
  'allow-once': { effect: 'allow', lifetime: 'once' },
  'allow-session': { effect: 'allow', lifetime: 'session' },
  'allow-always': { effect: 'allow', lifetime: 'persistent' },
  deny: { effect: 'deny', lifetime: 'once' },
});

const ALLOW_CHOICES: readonly (readonly [ApprovalPrompt['allowLifetimes'][number], FirewallChoice])[] = [
  ['once', 'allow-once'],
  ['session', 'allow-session'],
  ['persistent', 'allow-always'],
];

function toRequest(requirement: PermissionRequirement): FirewallRequest {
  const kind = requirement.category === 'interface' ? 'access' : requirement.category === 'network' ? 'network' : 'resource';
  return { kind, domain: requirement.domain, operation: requirement.operation, target: requirement.scope.value };
}

function isLink(requests: readonly FirewallRequest[]): boolean {
  return requests.length > 0 && requests.every((request) => request.operation === 'link.open');
}

/**
 * Turn kehto's approval prompt into what the host shows: who is asking, what
 * for, and which answers are open.
 *
 * The summary carries no copy. Domains and requests are named by their
 * identifiers and the host words them, as it already words grants. A link is
 * answered for that one opening only, whatever lifetimes kehto offers, because
 * the shell asks about every link (D-056). Anything else offers each lifetime
 * kehto allows: once, while the applet stays open, and always when answers
 * can be stored. An applet starting up is never offered `once`, because kehto
 * admits a start for the whole run.
 *
 * @param prompt - What kehto's approval coordinator asks.
 * @param applet - The applet the request came from, as the shell knows it.
 * @returns The facts of a `firewall.approve` ask.
 * @example
 * ```ts
 * const summary = describeApproval(prompt, { title: 'Notes', catalogId, identity });
 * summary.kind; // 'link'
 * summary.choices; // ['allow-once', 'deny']
 * ```
 */
export function describeApproval(prompt: Pick<ApprovalPrompt, 'missing' | 'allowLifetimes'>, applet: FirewallApplet): FirewallSummary {
  const requests = prompt.missing.map(toRequest);
  if (isLink(requests)) return { kind: 'link', applet, requests, choices: ['allow-once', 'deny'] };
  const offered = ALLOW_CHOICES.filter(([lifetime]) => prompt.allowLifetimes.includes(lifetime)).map(([, choice]) => choice);
  const kind = requests.every((request) => request.kind === 'access') ? 'access' : 'request';
  return { kind, applet, requests, choices: [...offered, 'deny'] };
}

/**
 * The answer kehto gets for the choice the person made. Dismissing the prompt,
 * or naming a choice it did not offer, cancels the request without storing
 * anything, so the applet may ask again.
 *
 * @param summary - The summary the host was shown.
 * @param choice - What the person chose, or `undefined` when they dismissed it.
 * @returns kehto's approval answer.
 * @example
 * ```ts
 * answerFor(summary, 'allow-once'); // { effect: 'allow', lifetime: 'once' }
 * answerFor(summary, undefined); // { effect: 'cancel' }
 * ```
 */
export function answerFor(summary: Pick<FirewallSummary, 'choices'>, choice: FirewallChoice | undefined): ApprovalAnswer {
  if (choice === undefined || !summary.choices.includes(choice)) return { effect: 'cancel' };
  return ANSWERS[choice];
}
