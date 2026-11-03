import { prepareNappletSrcdoc, resolveShellEnvironment, type NappletCspDirectives, type ShellAdapter } from '@kehto/shell';
import { createAppletCsp, type GuardProfile } from '@kernl/guard';
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
 * Build everything `mountApplet` needs, without touching the DOM.
 *
 * The environment is kehto's `resolveShellEnvironment`, so it is the live
 * domains narrowed by the host's `capabilities.resolveEnvironment` (kernl's
 * grants). The CSP is the guard's zero-network profile, inserted first in
 * `<head>` by `prepareNappletSrcdoc` along with the mandatory namespace prelude.
 * `missingRequired` lists what the applet asked for and will not get, so the
 * host can warn before mounting.
 *
 * @param options - Summary, verified HTML, adapter, guard profile and window id.
 * @returns A plan whose `srcdoc` is ready to assign.
 * @example
 * ```ts
 * const plan = planMount({ summary, indexHtml, adapter, guardProfile: 'strict', windowId: 'w1' });
 * plan.sandbox; // 'allow-scripts'
 * ```
 */
export function planMount(options: PlanMountOptions): MountPlan {
  const { summary } = options;
  const environment = resolveShellEnvironment(options.adapter, { dTag: summary.identity.dTag, aggregateHash: summary.identity.hash });
  const domains = environment.capabilities.domains;
  const csp = createAppletCsp(options.guardProfile);
  return {
    windowId: options.windowId,
    summary,
    srcdoc: prepareNappletSrcdoc(options.indexHtml, {
      domains,
      csp: { connectOrigins: csp.connectOrigins, directives: csp.directives as NappletCspDirectives },
    }),
    sandbox: 'allow-scripts',
    environment,
    missingRequired: Object.freeze(summary.requires.filter((domain) => !domains.includes(domain))),
  };
}
