import { createState, evaluate, type EvaluateResult, type FirewallState, type Observation } from '@kehto/firewall';
import { classifyEnvelope } from './classify.js';
import { applyNappletRules } from './profiles.js';
import type { FocusFirewall, GuardConfig, GuardEnvelope, GuardEvent, OpClass, WindowVisibility } from './types.js';

/** Options for {@link createFocusFirewall}. */
export interface FocusFirewallOptions {
  readonly config: GuardConfig;
  /** Time source; defaults to `Date.now`. kehto's engine never reads a clock itself. */
  readonly now?: () => number;
  /** Receives `reject` and `flag` events derived from each evaluation. */
  readonly onEvent?: (event: GuardEvent) => void;
}

function buildObservation(
  napplet: string,
  opClass: OpClass,
  envelope: GuardEnvelope,
  visibility: WindowVisibility,
  now: number,
): Observation {
  const observation: Observation = { napplet, opClass, focused: visibility.focused, now };
  return {
    ...observation,
    ...(envelope.kind !== undefined && { kind: envelope.kind }),
    ...(envelope.size !== undefined && { size: envelope.size }),
    ...(visibility.msSinceFocusGain !== undefined && { msSinceFocusGain: visibility.msSinceFocusGain }),
  };
}

/** kehto's rate rule ids name the tier, not the class; the class is what a user needs to see. */
function reasonFor(result: EvaluateResult, opClass: OpClass): string {
  if (result.decision === 'prompt') return `prompt:${result.ruleId}`;
  return result.ruleId.startsWith('rate:') ? `rate:${opClass}` : result.ruleId;
}

/** Bursts stay as they are: this layer never supplies `initElapsedMs`, so it never creates one. */
function dropNapplet(state: FirewallState, napplet: string): FirewallState {
  const prefix = `${napplet}:`;
  const buckets = Object.fromEntries(Object.entries(state.buckets).filter(([key]) => !key.startsWith(prefix)));
  return { buckets, bursts: state.bursts };
}

/**
 * Create the focus-aware firewall: kehto's pure `evaluate` engine fed with
 * focus the shell observed, never focus the applet claimed.
 *
 * Decisions map to guard events as follows. `reject` emits `reject`; `pass`
 * with action `flag` emits `flag`; `prompt` emits `reject` with reason
 * `prompt:<ruleId>`. kernl treats a prompt as a denial here because the guard
 * runs before dispatch and has no UI; the shell's consent flow prompts the
 * user for destructive writes on its own path, not through the firewall.
 *
 * Per-class rates are registered on the first observation of each applet via
 * `applyNappletRules`, so the engine's `rate:opclass` tier applies to every
 * applet without core having to pre-register it.
 *
 * @param options - Configuration, time source and event sink.
 * @returns A firewall that keeps the kehto counter state for many windows.
 * @example
 * ```ts
 * const firewall = createFocusFirewall({ config: createGuardConfig('strict') });
 * const result = firewall.observe('w1', 'chat', { type: 'relay.publish' }, { visible: true, focused: true });
 * result.decision; // 'pass'
 * ```
 */
export function createFocusFirewall(options: FocusFirewallOptions): FocusFirewall {
  const now = options.now ?? Date.now;
  const onEvent = options.onEvent ?? (() => undefined);
  let config = options.config;
  let state = createState();
  const nappletsByWindow = new Map<string, Set<string>>();

  function emit(result: EvaluateResult, windowId: string, napplet: string, opClass: OpClass, at: number): void {
    if (result.decision === 'pass' && result.action !== 'flag') return;
    onEvent({
      disposition: result.decision === 'pass' ? 'flag' : 'reject',
      windowId,
      napplet,
      opClass,
      reason: reasonFor(result, opClass),
      at,
    });
  }

  return {
    observe(windowId, napplet, envelope, visibility) {
      if (config.firewall.napplets[napplet] === undefined) config = applyNappletRules(config, napplet);
      const seen = nappletsByWindow.get(windowId) ?? new Set<string>();
      seen.add(napplet);
      nappletsByWindow.set(windowId, seen);

      const opClass = classifyEnvelope(envelope);
      const at = now();
      const result = evaluate(config.firewall, state, buildObservation(napplet, opClass, envelope, visibility, at));
      state = result.newState;
      emit(result, windowId, napplet, opClass, at);
      return result;
    },
    forget(windowId) {
      // kehto keys budgets by applet, so this also resets the budget of another
      // window running the same applet. Revocation is user-driven; that is acceptable.
      for (const napplet of nappletsByWindow.get(windowId) ?? []) state = dropNapplet(state, napplet);
      nappletsByWindow.delete(windowId);
    },
  };
}
