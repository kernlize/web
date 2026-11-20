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
  type ShellEnvironment,
} from '@kehto/shell';
import { createAppletCsp, renderInsertionLockScript, type GuardProfile } from '@kernlize/guard';
import { renderRandomUuidFallbackScript } from '../crypto/install.js';
import type { BoundPreludeOptions, DomainBinding } from '../downloads/bindings.js';
import type { AppletSummary, MountPlan } from '../types.js';

/** Domains kernl serves that kehto's shell does not list, as one applet is to see them. */
export interface PlannedExtensions {
  /** The extension domains in force for this applet, already narrowed by its grants. */
  readonly domains: readonly string[];
  /** What each one offers inside the applet. */
  readonly bindings: Readonly<Record<string, DomainBinding>>;
}

/** Inputs for {@link planMount}. */
export interface PlanMountOptions {
  readonly summary: AppletSummary;
  /** Verified `index.html` text from {@link resolveApplet}. */
  readonly indexHtml: string;
  /** The live shell wiring; decides which domains exist at all. */
  readonly adapter: ShellAdapter;
  readonly guardProfile: GuardProfile;
  readonly windowId: string;
  /** Domains beyond kehto's own to add to the applet's environment and bind in its namespace. */
  readonly extensions?: PlannedExtensions;
  /** The domains the firewall admitted the applet with; the environment is narrowed to them. Everything the grants leave when absent. */
  readonly domains?: readonly string[];
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
 * script, followed by the `randomUUID` fallback (D-024) the prelude needs when
 * the shell is not a secure context. `@kehto/shell` has no hook for a second
 * prelude, so the pair is re-rendered and located in the srcdoc.
 */
function addInsertionLock(srcdoc: string, csp: NappletCspOptions, prelude: BoundPreludeOptions): string {
  const head = renderNappletCspMeta(csp, true) + renderNappletNamespacePrelude(prelude);
  return spliceOnce(srcdoc, head, head + renderInsertionLockScript() + renderRandomUuidFallbackScript());
}

/** The bindings for exactly the extension domains this applet holds; none leaves the prelude as kehto renders it alone. */
function bindingsFor(extensions: PlannedExtensions | undefined): Pick<BoundPreludeOptions, 'bindings'> {
  const held = Object.entries(extensions?.bindings ?? {}).filter(([domain]) => extensions?.domains.includes(domain));
  return held.length > 0 ? { bindings: Object.fromEntries(held) } : {};
}

/**
 * The environment an applet is offered before the firewall admits it: kehto's
 * live domains narrowed by the host's `capabilities.resolveEnvironment`,
 * which in kernl is the grants layer.
 *
 * @param adapter - The shell adapter.
 * @param summary - The verified applet.
 * @returns The environment the grants leave the applet.
 * @example
 * ```ts
 * resolveAppletEnvironment(adapter, summary).capabilities.domains; // ['shell', 'identity', 'theme', …]
 * ```
 */
export function resolveAppletEnvironment(adapter: ShellAdapter, summary: Pick<AppletSummary, 'identity'>): ShellEnvironment {
  return resolveShellEnvironment(adapter, { dTag: summary.identity.dTag, aggregateHash: summary.identity.hash });
}

/** Keep only the domains the firewall admitted; everything when it was not asked. */
function narrowEnvironment(environment: ShellEnvironment, domains: readonly string[] | undefined): ShellEnvironment {
  if (!domains) return environment;
  const kept = environment.capabilities.domains.filter((domain) => domains.includes(domain));
  return { ...environment, capabilities: { ...environment.capabilities, domains: kept } };
}

/**
 * Build everything `mountApplet` needs, without touching the DOM.
 *
 * The environment is kehto's `resolveShellEnvironment`, so it is the live
 * domains narrowed by the host's `capabilities.resolveEnvironment` (kernl's
 * grants), and then by `domains` when the firewall admitted fewer. The CSP is the guard's zero-network profile, inserted first in
 * `<head>` by `prepareNappletSrcdoc` with kehto's nested-context lock enabled
 * (`experimental.nestedContextLock`): the policy gains kehto's Trusted Types
 * directives and the mandatory namespace prelude installs kehto's creation
 * lock. kernl's insertion lock follows the prelude. Markup that declares a
 * nested frame is refused by kehto's scan before any of that (D-014).
 * `extensions` adds the domains kernl serves beyond kehto's list, with the
 * bindings kehto's prelude turns into `window.napplet.<domain>` (D-050).
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
  // The firewall admitted kehto's domains and the extension domains together; the plan holds only what it admitted (D-056).
  const live = narrowEnvironment(resolveAppletEnvironment(options.adapter, summary), options.domains);
  const domains = Object.freeze([...live.capabilities.domains, ...(options.extensions?.domains ?? [])]);
  // kehto reads a window's domains from the environment the host sets at mount, so an extension domain is admitted by being in it.
  const environment = Object.freeze({ capabilities: Object.freeze({ domains }), services: live.services });
  const prelude: BoundPreludeOptions = { domains, experimental: NESTED_CONTEXT_LOCK, ...bindingsFor(options.extensions) };
  const guardCsp = createAppletCsp(options.guardProfile);
  const csp: NappletCspOptions = { connectOrigins: guardCsp.connectOrigins, directives: guardCsp.directives as NappletCspDirectives };
  return {
    windowId: options.windowId,
    summary,
    srcdoc: addInsertionLock(prepareNappletSrcdoc(options.indexHtml, { ...prelude, csp }), csp, prelude),
    sandbox: 'allow-scripts',
    environment,
    missingRequired: Object.freeze(summary.requires.filter((domain) => !domains.includes(domain))),
  };
}
