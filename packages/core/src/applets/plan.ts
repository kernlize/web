import {
  assertNappletHasNoFrame,
  prepareNappletSrcdoc,
  renderNappletCspMeta,
  renderNappletNamespacePrelude,
  resolveShellEnvironment,
  type NappletCspDirectives,
  type NappletCspOptions,
  type NappletExperimentalOptions,
  type ShellAdapter,
} from '@kehto/shell';
import { createAppletCsp, renderInsertionLockScript, type GuardProfile } from '@kernlize/guard';
import type { AppletSummary, MountPlan } from '../types.js';

/** Inputs for {@link planMount}. */
export interface PlanMountOptions {
  readonly summary: AppletSummary;
  /** Verified `index.html` text from {@link resolveApplet}. */
  readonly indexHtml: string;
  /** The live shell wiring; decides which domains exist at all. */
  readonly adapter: ShellAdapter;
  readonly guardProfile: GuardProfile;
  readonly windowId: string;
}

/**
 * Replace the first occurrence of `find` in `text`, refusing when it is absent.
 *
 * @param text - The text to edit.
 * @param find - The exact substring to replace.
 * @param replacement - What takes its place.
 * @returns The edited text.
 * @throws `Error('unavailable:frame-lock')` when `find` does not occur.
 * @example
 * ```ts
 * spliceOnce('a<b>c', '<b>', '<b><i>'); // 'a<b><i>c'
 * ```
 */
export function spliceOnce(text: string, find: string, replacement: string): string {
  const at = text.indexOf(find);
  if (at === -1) throw new Error('unavailable:frame-lock');
  return `${text.slice(0, at)}${replacement}${text.slice(at + find.length)}`;
}

/** kehto's nested-context lock: Trusted Types directives in the CSP, the policy and factory pins in the prelude. */
const NESTED_CONTEXT_LOCK: NappletExperimentalOptions = Object.freeze({ nestedContextLock: true });

/**
 * Refuse verified markup that declares a nested frame, with kernl's stable
 * reason in place of kehto's message.
 *
 * @param html - Verified applet HTML.
 * @throws `Error('denied:nested-frame')` when kehto's scan finds a frame element.
 */
function assertNoFrame(html: string): void {
  try {
    assertNappletHasNoFrame(html);
  } catch {
    throw new Error('denied:nested-frame');
  }
}

/**
 * Insert kernl's insertion lock (D-014) immediately after the CSP meta and
 * locked namespace prelude kehto put first in `<head>`, before any applet
 * script. `@kehto/shell` has no hook for a second prelude, so the pair is
 * re-rendered and located in the srcdoc.
 */
function addInsertionLock(srcdoc: string, csp: NappletCspOptions, domains: readonly string[]): string {
  const head = renderNappletCspMeta(csp, true) + renderNappletNamespacePrelude({ domains, experimental: NESTED_CONTEXT_LOCK });
  return spliceOnce(srcdoc, head, head + renderInsertionLockScript());
}

/**
 * Build everything `mountApplet` needs, without touching the DOM.
 *
 * The environment is kehto's `resolveShellEnvironment`, so it is the live
 * domains narrowed by the host's `capabilities.resolveEnvironment` (kernl's
 * grants). The CSP is the guard's zero-network profile, inserted first in
 * `<head>` by `prepareNappletSrcdoc` with kehto's nested-context lock enabled
 * (`experimental.nestedContextLock`): the policy gains kehto's Trusted Types
 * directives and the mandatory namespace prelude installs kehto's creation
 * lock. kernl's insertion lock follows the prelude. Markup that declares a
 * nested frame is refused by kehto's scan before any of that (D-014).
 * `missingRequired` lists what the applet asked for and will not get, so the
 * host can warn before mounting.
 *
 * @param options - Summary, verified HTML, adapter, guard profile and window id.
 * @returns A plan whose `srcdoc` is ready to assign.
 * @throws `Error('denied:nested-frame')` when the verified markup declares a frame element.
 * @throws `Error('unavailable:frame-lock')` when kehto's head cannot be found to place the insertion lock.
 * @example
 * ```ts
 * const plan = planMount({ summary, indexHtml, adapter, guardProfile: 'strict', windowId: 'w1' });
 * plan.sandbox; // 'allow-scripts'
 * ```
 */
export function planMount(options: PlanMountOptions): MountPlan {
  const { summary } = options;
  assertNoFrame(options.indexHtml);
  const environment = resolveShellEnvironment(options.adapter, { dTag: summary.identity.dTag, aggregateHash: summary.identity.hash });
  const domains = environment.capabilities.domains;
  const guardCsp = createAppletCsp(options.guardProfile);
  const csp: NappletCspOptions = { connectOrigins: guardCsp.connectOrigins, directives: guardCsp.directives as NappletCspDirectives };
  return {
    windowId: options.windowId,
    summary,
    srcdoc: addInsertionLock(prepareNappletSrcdoc(options.indexHtml, { domains, csp, experimental: NESTED_CONTEXT_LOCK }), csp, domains),
    sandbox: 'allow-scripts',
    environment,
    missingRequired: Object.freeze(summary.requires.filter((domain) => !domains.includes(domain))),
  };
}
