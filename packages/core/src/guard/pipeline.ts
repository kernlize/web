import { BehaviorSubject, type Observable } from 'rxjs';
import {
  classifyEnvelope,
  createFocusFirewall,
  createGuardConfig,
  createIngressGuard,
  createVisibilityGate,
  estimateEnvelopeSize,
  type FocusFirewall,
  type GuardConfig,
  type GuardDisposition,
  type GuardEnvelope,
  type GuardEvent,
  type GuardProfile,
  type IngressGuard,
  type VisibilityGate,
  type WindowVisibility,
} from '@kernl/guard';

/** The window a message came from, as the shell resolved it. Never taken from the message. */
export interface WindowResolution {
  readonly windowId: string;
  readonly napplet: string;
}

/** Options for {@link createGuardPipeline}. */
export interface GuardPipelineOptions {
  readonly config: GuardConfig;
  readonly now?: () => number;
  /** Receives every guard event from every layer. */
  readonly onEvent?: (event: GuardEvent) => void;
  /** Called once when a window crosses the quarantine threshold; kernl revokes it here, before the triggering envelope is dispatched. */
  readonly onQuarantine?: (windowId: string, napplet: string) => void;
  /** Visibility for a window the pipeline has not been told about yet. */
  readonly getVisibility?: (windowId: string) => WindowVisibility;
}

/** What the pipeline decided about a message. `unrouted` means no registered window sent it. */
export type PipelineDisposition = GuardDisposition | 'unrouted';

/** A message held back until its window is visible or its budget refills. */
interface Pending {
  readonly event: MessageEvent;
  readonly napplet: string;
  readonly envelope: GuardEnvelope;
  readonly forward: (event: MessageEvent) => void;
}

/** The composed guard the shell puts in front of kehto's bridge. */
export interface GuardPipeline {
  readonly config: GuardConfig;
  readonly profile$: Observable<GuardProfile>;
  /** Rebuild every layer for a profile. Held messages are dropped; counters restart. */
  setProfile(profile: GuardProfile): void;
  /**
   * Admit, hold or drop one window-level message. Messages from unregistered
   * windows are forwarded so the bridge can report them as unrouted.
   */
  handleWindowMessage(event: MessageEvent, resolveWindow: (event: MessageEvent) => WindowResolution | null, forward: (event: MessageEvent) => void): PipelineDisposition;
  /**
   * Observe one envelope that arrived over a bound port. kehto calls this
   * synchronously just before it dispatches the envelope to the runtime, and
   * ignores the return value, so nothing can be held or delayed here:
   * counters advance and events are emitted. A quarantine triggers
   * `onQuarantine`, and when that revokes the binding (as `createKernl` does)
   * kehto no longer finds the window's session and drops this envelope
   * instead of dispatching it.
   */
  observe(windowId: string, napplet: string, message: unknown): GuardDisposition;
  setVisibility(windowId: string, visibility: WindowVisibility): void;
  getVisibility(windowId: string): WindowVisibility;
  /** Lift quarantine after the user chose to. */
  release(windowId: string): void;
  isQuarantined(windowId: string): boolean;
  /** Drop every queue and counter for a window. */
  forget(windowId: string): void;
  /** Forward what the budget and visibility now allow. */
  drainAll(windowId: string): void;
}

interface Layers {
  ingress: IngressGuard;
  gate: VisibilityGate;
  firewall: FocusFirewall;
}

function toEnvelope(data: unknown): GuardEnvelope {
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const event = typeof record.event === 'object' && record.event !== null ? (record.event as Record<string, unknown>) : {};
  const envelope: GuardEnvelope = {
    type: typeof record.type === 'string' ? record.type : 'unknown',
    size: estimateEnvelopeSize(data),
  };
  return typeof event.kind === 'number' ? { ...envelope, kind: event.kind } : envelope;
}

/**
 * Compose the guard: ingress flood control, then the visibility gate, then the
 * focus-aware firewall, then kehto's bridge.
 *
 * What is enforced where (D-001): kehto binds NAP traffic to a `MessagePort`
 * the bridge owns, so the only window-level message the pipeline can hold or
 * drop is `napplet.hello`. Port traffic reaches the pipeline through
 * `ShellAdapter.onNappletMessage`, which kehto calls synchronously before it
 * dispatches each envelope but treats as observe-only: its answer cannot hold,
 * delay or refuse the envelope. Rejections and flags therefore become events
 * for the user while the envelope is still handled. Quarantine is the one
 * disposition with an effect on the envelope itself: the shell revokes the
 * window inside the callback, kehto then finds no session for it, and the
 * envelope that crossed the limit is dropped along with everything after it.
 * Pre-dispatch limits for port traffic come from the runtime firewall
 * configured by `applyRuntimeFirewallRules`.
 *
 * @param options - Configuration, clock, event sink and quarantine callback.
 * @returns The pipeline.
 * @example
 * ```ts
 * const pipeline = createGuardPipeline({ config: createGuardConfig('strict'), onEvent: (e) => log.push(e) });
 * window.addEventListener('message', (event) => pipeline.handleWindowMessage(event, resolve, bridge.handleMessage));
 * ```
 */
export function createGuardPipeline(options: GuardPipelineOptions): GuardPipeline {
  let config = options.config;
  const profile$ = new BehaviorSubject<GuardProfile>(config.profile);
  const known = new Map<string, WindowVisibility>();
  const heldByIngress = new Map<string, Pending[]>();
  const heldByGate = new Map<string, Pending[]>();
  const layerOptions = () => ({
    config,
    ...(options.now ? { now: options.now } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
  });
  // The gate only asks for the applet while `defer` runs, which always follows `admit`.
  let deferring = '';
  const buildLayers = (): Layers => ({
    ingress: createIngressGuard(layerOptions()),
    gate: createVisibilityGate({ ...layerOptions(), nappletFor: () => deferring }),
    firewall: createFocusFirewall(layerOptions()),
  });
  let layers = buildLayers();

  function visibilityOf(windowId: string): WindowVisibility {
    if (!known.has(windowId) && options.getVisibility) {
      const visibility = options.getVisibility(windowId);
      known.set(windowId, visibility);
      layers.gate.setVisibility(windowId, visibility);
    }
    return layers.gate.getVisibility(windowId);
  }

  function push(queue: Map<string, Pending[]>, windowId: string, pending: Pending): void {
    const list = queue.get(windowId) ?? [];
    list.push(pending);
    queue.set(windowId, list);
  }

  function take(queue: Map<string, Pending[]>, windowId: string, count: number): Pending[] {
    const list = queue.get(windowId) ?? [];
    return list.splice(0, count);
  }

  function pastGate(windowId: string, pending: Pending): GuardDisposition {
    const opClass = classifyEnvelope(pending.envelope);
    if (layers.gate.shouldDefer(windowId, opClass)) {
      deferring = pending.napplet;
      if (!layers.gate.defer(windowId, pending.envelope)) return 'reject';
      push(heldByGate, windowId, pending);
      return 'defer';
    }
    return pastFirewall(windowId, pending);
  }

  function pastFirewall(windowId: string, pending: Pending): GuardDisposition {
    const result = layers.firewall.observe(windowId, pending.napplet, pending.envelope, visibilityOf(windowId));
    if (result.decision !== 'pass') return 'reject';
    pending.forward(pending.event);
    return 'pass';
  }

  function admit(windowId: string, napplet: string, envelope: GuardEnvelope): GuardDisposition {
    const disposition = layers.ingress.admit(windowId, napplet, envelope, visibilityOf(windowId));
    if (disposition === 'quarantine') options.onQuarantine?.(windowId, napplet);
    return disposition;
  }

  function drainAll(windowId: string): void {
    const released = layers.ingress.drain(windowId).length;
    for (const pending of take(heldByIngress, windowId, released)) pastGate(windowId, pending);
    const visible = layers.gate.drain(windowId).length;
    for (const pending of take(heldByGate, windowId, visible)) pastFirewall(windowId, pending);
  }

  return {
    get config() {
      return config;
    },
    profile$,
    setProfile(profile) {
      config = createGuardConfig(profile);
      layers = buildLayers();
      heldByIngress.clear();
      heldByGate.clear();
      for (const [windowId, visibility] of known) layers.gate.setVisibility(windowId, visibility);
      profile$.next(profile);
    },
    handleWindowMessage(event, resolveWindow, forward) {
      const resolved = resolveWindow(event);
      if (!resolved) {
        forward(event);
        return 'unrouted';
      }
      const { windowId, napplet } = resolved;
      const pending: Pending = { event, napplet, envelope: toEnvelope(event.data), forward };
      const disposition = admit(windowId, napplet, pending.envelope);
      if (disposition === 'defer') push(heldByIngress, windowId, pending);
      return disposition === 'pass' ? pastGate(windowId, pending) : disposition;
    },
    observe(windowId, napplet, message) {
      const envelope = toEnvelope(message);
      const disposition = admit(windowId, napplet, envelope);
      if (disposition === 'pass') layers.firewall.observe(windowId, napplet, envelope, visibilityOf(windowId));
      return disposition;
    },
    setVisibility(windowId, visibility) {
      known.set(windowId, visibility);
      layers.gate.setVisibility(windowId, visibility);
      if (visibility.visible) drainAll(windowId);
    },
    getVisibility: visibilityOf,
    release: (windowId) => layers.ingress.release(windowId),
    isQuarantined: (windowId) => layers.ingress.isQuarantined(windowId),
    forget(windowId) {
      layers.ingress.forget(windowId);
      layers.gate.forget(windowId);
      layers.firewall.forget(windowId);
      heldByIngress.delete(windowId);
      heldByGate.delete(windowId);
      known.delete(windowId);
    },
    drainAll,
  };
}
