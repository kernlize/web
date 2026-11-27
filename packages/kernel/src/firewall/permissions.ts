import type { ApprovalAnswer, ApprovalPrompt, PermissionAdapter, PermissionRateEvent, PermissionStorageFailure, TemporalPolicy } from '@kehto/runtime';
import type { PermissionPrincipal } from '@kehto/firewall';
import { createRateLimiter, defaultPromptRateLimitConfig } from '@kehto/rate-limit';
import type { AppletSummary, FirewallApplet, FirewallSummary, KernlHost } from '../types.js';
import { toAskChannel, type AskChannel } from '../asks/channel.js';
import { answerFor, describeApproval } from './describe.js';
import type { FirewallRules } from './rules.js';

/**
 * Where the answers the person asked the firewall to keep are stored.
 *
 * @example
 * ```ts
 * localStorage.getItem(FIREWALL_DECISIONS_STORAGE_KEY); // kehto's serialised grants; only `allow-always` answers are in it
 * ```
 */
export const FIREWALL_DECISIONS_STORAGE_KEY = 'kernl:firewall-decisions:v1';

/**
 * How long a firewall question may wait for the person, queue time included.
 * kehto's own default is a minute, which takes a question away from someone
 * who looked elsewhere; kernl only gives up on one nobody is coming back to.
 *
 * @example
 * ```ts
 * FIREWALL_PROMPT_TIMEOUT_MS; // 600000
 * ```
 */
export const FIREWALL_PROMPT_TIMEOUT_MS = 10 * 60_000;

/**
 * The identity kehto's firewall knows an applet by: its catalogue id, which
 * rules follow across versions, and the hash of the exact code, which stored
 * answers are tied to. Both come from the verified manifest, never from
 * anything the applet sent.
 *
 * @param summary - A summary this shell verified.
 * @returns The principal to register with the applet's session.
 * @example
 * ```ts
 * permissionPrincipalFor(summary); // { kind: 'verified', manifestKey: 'nip5d:35129:…:notes', artifactHash: '…' }
 * ```
 */
export function permissionPrincipalFor(summary: Pick<AppletSummary, 'identity' | 'manifest'>): PermissionPrincipal {
  return { kind: 'verified', manifestKey: summary.manifest.catalogId, artifactHash: summary.identity.hash };
}

const STORAGE_FAILURES: Readonly<Record<PermissionStorageFailure, string>> = Object.freeze({
  'load-failed': 'They could not be read. Applets are refused until you clear them.',
  'invalid-state': 'They are damaged. Applets are refused until you clear them.',
  'unsupported-version': 'A newer shell wrote them. Applets are refused until you clear them.',
  'save-failed': 'That answer could not be stored, so it was not applied.',
  'storage-unavailable': 'This browser keeps no stored answers, so "always" cannot be given.',
});

/** kernl's own heading for each kind of firewall question. */
const FIREWALL_TITLES: Readonly<Record<FirewallSummary['kind'], string>> = Object.freeze({
  link: 'Open a link outside kernl',
  access: 'Start with what it asks for',
  request: 'Go ahead with a request',
});

/** Options for {@link createFirewallPermissions}. */
export interface FirewallPermissionsOptions {
  readonly host: Pick<KernlHost, 'storage' | 'asks' | 'notify' | 'now'>;
  /** The channel `firewall.approve` goes through; the host's own by default. */
  readonly asks?: AskChannel;
  readonly rules: Pick<FirewallRules, 'decide'>;
  /** The applet a principal belongs to, from what this shell planned; `undefined` for one it does not know. */
  readonly appletOf: (principal: PermissionPrincipal) => FirewallApplet | undefined;
  /** Budgets for what the runtime carries out; see `createRuntimeRateLimiter`. */
  readonly rateLimiter: TemporalPolicy;
  /** Receives every spent budget, the question budget included. */
  readonly onRateLimit: (event: PermissionRateEvent) => void;
}

/**
 * kehto's approval adapter for kernl: the firewall's host side.
 *
 * A request no stored answer covers goes to the rules first. What they allow
 * goes ahead, what they deny is refused, and what they say to ask about is
 * put to the person as a `firewall.approve` ask; a host that draws none has
 * such a request refused, never allowed. A question for an applet this shell
 * did not plan is cancelled. "Always" answers are kept under
 * {@link FIREWALL_DECISIONS_STORAGE_KEY}; a failed write is told to the person
 * and grants nothing. An applet that asks too often has its questions dropped
 * by kehto's suggested budget, twelve a minute.
 *
 * @param options - Host, rules, the applet lookup and the runtime's rate limiter.
 * @returns The adapter for `ShellAdapter.permissions`.
 * @example
 * ```ts
 * const permissions = createFirewallPermissions({ host, rules, appletOf, rateLimiter, onRateLimit });
 * const adapter: ShellAdapter = { ...rest, permissions };
 * ```
 */
export function createFirewallPermissions(options: FirewallPermissionsOptions): PermissionAdapter {
  const { host } = options;
  const asks = options.asks ?? toAskChannel(host);
  const ask = (prompt: ApprovalPrompt): Promise<ApprovalAnswer> => {
    const applet = options.appletOf(prompt.request.principal);
    if (!applet) return Promise.resolve({ effect: 'cancel' });
    const summary = describeApproval(prompt, applet);
    return new Promise((resolve) => {
      const withdrawn = (): void => resolve({ effect: 'cancel' });
      prompt.signal.addEventListener('abort', withdrawn, { once: true });
      void asks.ask({ kind: 'firewall.approve', applet: applet.identity, facts: summary, defaultText: { title: FIREWALL_TITLES[summary.kind] }, signal: prompt.signal }).then((choice) => {
        prompt.signal.removeEventListener('abort', withdrawn);
        resolve(answerFor(summary, choice));
      });
    });
  };
  return {
    now: host.now ? host.now.bind(host) : Date.now,
    createCancellation: () => new AbortController(),
    schedule(callback, delayMs) {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
    timeoutMs: FIREWALL_PROMPT_TIMEOUT_MS,
    ...(asks.has('firewall.approve') ? { prompt: ask } : {}),
    defaultDecision: (request, missing) => options.rules.decide(request, missing),
    persistence: {
      load: () => host.storage.getItem(FIREWALL_DECISIONS_STORAGE_KEY),
      persist: (serialized) => host.storage.setItem(FIREWALL_DECISIONS_STORAGE_KEY, serialized),
    },
    onStorageError: (failure) => host.notify({ title: 'Firewall: stored answers', body: STORAGE_FAILURES[failure], tone: 'warning' }),
    rateLimiter: options.rateLimiter,
    promptRateLimiter: createRateLimiter(defaultPromptRateLimitConfig()),
    onRateLimit: options.onRateLimit,
  };
}
