import {
  prepareNappletSrcdoc,
  renderNappletCspMeta,
  renderNappletNamespacePrelude,
  resolveShellEnvironment,
  type NappletCspDirectives,
  type NappletCspOptions,
  type ShellAdapter,
} from '@kehto/shell';
import { assertAppletHasNoFrame, createAppletCsp, renderFrameLockScript, type GuardProfile } from '@kernl/guard';
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

/**
 * Arm kernl's port of kehto's nested-context lock (D-014) in a srcdoc kehto
 * prepared. `@kehto/shell` 0.29.0 refuses CSP directives outside its baseline
 * and has no hook for a second prelude, so the head kehto inserted is rebuilt
 * in place: its CSP meta gains the Trusted Types directives, and the frame-lock
 * script follows kehto's namespace prelude, before any applet script.
 */
function lockNestedContexts(srcdoc: string, csp: NappletCspOptions, domains: readonly string[], trustedTypes: string): string {
  const meta = renderNappletCspMeta(csp);
  const prelude = renderNappletNamespacePrelude({ domains });
  const lockedMeta = spliceOnce(meta, '">', `; ${trustedTypes}">`);
  return spliceOnce(srcdoc, meta + prelude, lockedMeta + prelude + renderFrameLockScript());
}

/**
 * Build everything `mountApplet` needs, without touching the DOM.
 *
 * The environment is kehto's `resolveShellEnvironment`, so it is the live
 * domains narrowed by the host's `capabilities.resolveEnvironment` (kernl's
 * grants). The CSP is the guard's zero-network profile plus its Trusted Types
 * directives, inserted first in `<head>` by `prepareNappletSrcdoc` along with
 * the mandatory namespace prelude and then the guard's frame lock. Markup that
 * declares a nested frame is refused before any of that (D-014).
 * `missingRequired` lists what the applet asked for and will not get, so the
 * host can warn before mounting.
 *
 * @param options - Summary, verified HTML, adapter, guard profile and window id.
 * @returns A plan whose `srcdoc` is ready to assign.
 * @throws `Error('denied:nested-frame')` when the verified markup declares a frame element.
 * @example
 * ```ts
 * const plan = planMount({ summary, indexHtml, adapter, guardProfile: 'strict', windowId: 'w1' });
 * plan.sandbox; // 'allow-scripts'
 * ```
 */
export function planMount(options: PlanMountOptions): MountPlan {
  const { summary } = options;
  assertAppletHasNoFrame(options.indexHtml);
  const environment = resolveShellEnvironment(options.adapter, { dTag: summary.identity.dTag, aggregateHash: summary.identity.hash });
  const domains = environment.capabilities.domains;
  const guardCsp = createAppletCsp(options.guardProfile);
  const csp: NappletCspOptions = { connectOrigins: guardCsp.connectOrigins, directives: guardCsp.directives as NappletCspDirectives };
  return {
    windowId: options.windowId,
    summary,
    srcdoc: lockNestedContexts(prepareNappletSrcdoc(options.indexHtml, { domains, csp }), csp, domains, guardCsp.trustedTypes),
    sandbox: 'allow-scripts',
    environment,
    missingRequired: Object.freeze(summary.requires.filter((domain) => !domains.includes(domain))),
  };
}
