import type { Firewall, FirewallChoice, FirewallDecision, FirewallRequest, FirewallRuleTarget, FirewallSummary } from './contract';
import { domainLabel } from './domains';

/** What the firewall does with a request no answer covers. */
export type RuleAction = 'allow' | 'ask' | 'deny';

/** A rule as a person picks it: an action, or nothing of its own so the wider rule applies. */
export type RuleChoice = RuleAction | 'inherit';

/** Every action, in the order the panel lists them. */
export const RULE_ACTIONS: readonly RuleAction[] = ['allow', 'ask', 'deny'];

const ACTION_WORDS: Readonly<Record<RuleAction, string>> = {
  allow: 'Allow without asking',
  ask: 'Ask me every time',
  deny: 'Refuse',
};

/** Plain words for a rule's action. */
export const actionWords = (action: RuleAction): string => ACTION_WORDS[action];

/** The request an applet makes to open a link, as the firewall names it. */
export const LINK_REQUEST = 'link.open';

/** Where an address leads, for the line under it: the site for a web address, the mail app for a mail one. */
export function destinationOf(target: string): string {
  try {
    const url = new URL(target);
    return url.protocol === 'mailto:' ? 'your mail app' : url.host;
  } catch {
    return target;
  }
}

function sentenceList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) as string}`;
}

/** The question a firewall prompt puts, after "<applet> wants to". */
export function firewallTitle(summary: Pick<FirewallSummary, 'kind' | 'requests'>): string {
  if (summary.kind === 'link') return 'Open a link outside kernl';
  if (summary.kind === 'access') return `Use ${sentenceList([...new Set(summary.requests.map((request) => domainLabel(request.domain)))])}`;
  return 'Go ahead with a request';
}

/** One row of a firewall prompt. */
export interface FirewallLine {
  readonly label: string;
  readonly value: string;
}

function lineFor(request: FirewallRequest): FirewallLine {
  if (request.kind === 'network') return { label: 'Reaches', value: destinationOf(request.target) };
  return { label: request.kind === 'access' ? 'Uses' : 'For', value: domainLabel(request.domain) };
}

/** What a firewall prompt shows under its question. Rows that would read the same are shown once. */
export function firewallLines(summary: Pick<FirewallSummary, 'kind' | 'requests'>): readonly FirewallLine[] {
  if (summary.kind === 'link') {
    const [link] = summary.requests as readonly [FirewallRequest, ...FirewallRequest[]];
    return [{ label: 'Link', value: link.target }, { label: 'Leads to', value: destinationOf(link.target) }];
  }
  const lines = summary.requests.map(lineFor);
  return lines.filter((line, index) => lines.findIndex((other) => other.label === line.label && other.value === line.value) === index);
}

const NOTES: Readonly<Record<FirewallSummary['kind'], string>> = {
  link: 'Opens in a new tab, outside kernl.',
  access: 'One of your firewall rules asks before it starts.',
  request: 'One of your firewall rules asks about this.',
};

/** The one line under a firewall prompt: what happens, or why the person is asked. */
export const firewallNote = (kind: FirewallSummary['kind']): string => NOTES[kind];

const CHOICE_WORDS: Readonly<Record<FirewallChoice, string>> = {
  'allow-once': 'Allow once',
  'allow-session': 'Allow while it is open',
  'allow-always': 'Always allow',
  deny: 'Don’t allow',
};

/** The words on an answer's button. A link is opened or not; anything else is allowed or not. */
export function choiceWords(choice: FirewallChoice, kind: FirewallSummary['kind']): string {
  if (kind !== 'link') return CHOICE_WORDS[choice];
  return choice === 'deny' ? 'Don’t open' : 'Open link';
}

function whatOf(request: FirewallRequest): string {
  if (request.operation === LINK_REQUEST) return `opening ${destinationOf(request.target)}`;
  if (request.kind === 'network') return `${domainLabel(request.domain)}, reaching ${destinationOf(request.target)}`;
  return domainLabel(request.domain);
}

/** An answer in force, in a sentence fragment: "network: allowed, kept across visits". */
export function decisionWords(decision: Pick<FirewallDecision, 'request' | 'effect' | 'lifetime'>): string {
  const verdict = decision.effect === 'allow' ? 'allowed' : 'refused';
  const until = decision.lifetime === 'always' ? 'kept across visits' : 'until its window closes';
  return `${whatOf(decision.request)}: ${verdict}, ${until}`;
}

type Rules = ReturnType<Firewall['rules']>;

/**
 * The rule set at exactly this target, or `inherit` when there is none of its own and the next
 * wider rule decides. The rule for everything always has an action.
 */
export function ruleChoice(rules: Rules, target: FirewallRuleTarget): RuleChoice {
  const scope = target.applet === undefined ? rules : rules.napplets[target.applet];
  if (!scope) return 'inherit';
  if (target.operation !== undefined) return scope.operations[target.operation] ?? 'inherit';
  if (target.domain !== undefined) return scope.domains[target.domain] ?? 'inherit';
  return scope.default ?? 'inherit';
}

type Scope = Pick<Rules, 'domains' | 'operations'> & { readonly default?: RuleAction };

/** An applet with no rules of its own still has its places in the order, all empty. */
const NO_RULES: Scope = { domains: {}, operations: {} };

/** The rules that could decide a target, most specific first, as kehto reads them: the request, its domain, then the default. */
function candidates(scope: Scope, target: FirewallRuleTarget): readonly (RuleAction | undefined)[] {
  const domain = target.domain ?? target.operation?.split('.')[0];
  return [
    ...(target.operation !== undefined ? [scope.operations[target.operation]] : []),
    ...(domain !== undefined ? [scope.domains[domain]] : []),
    scope.default,
  ];
}

function decided(rules: Rules, target: FirewallRuleTarget, skipOwn: boolean): RuleAction {
  const own = target.applet === undefined ? [] : candidates(rules.napplets[target.applet] ?? NO_RULES, target);
  const all = [...own, ...candidates(rules, target)].slice(skipOwn ? 1 : 0);
  return all.find((action) => action !== undefined) ?? rules.default;
}

/** What happens at a target: its own rule, else the next wider one, down to the rule for everything. */
export const ruleInForce = (rules: Rules, target: FirewallRuleTarget): RuleAction => decided(rules, target, false);

/** What the "no rule of its own" option says, naming what applies in its place. */
export const inheritWords = (rules: Rules, target: FirewallRuleTarget): string => `Follow the wider rule (${actionWords(decided(rules, target, true)).toLowerCase()})`;

/** The value a rule select hands back, as the action to set or `undefined` to remove the rule. */
export const toRuleAction = (choice: string): RuleAction | undefined => (RULE_ACTIONS as readonly string[]).includes(choice) ? (choice as RuleAction) : undefined;
