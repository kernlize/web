import { TRUSTED_TYPES_DIRECTIVES } from './frame-lock.js';
import type { GuardProfile } from './types.js';

/** CSP input structurally compatible with kehto's `NappletCspOptions`. */
export interface AppletCsp {
  /** Origins the applet may contact directly. Always empty: the network is a shell service. */
  readonly connectOrigins: readonly string[];
  /** Source lists for every directive the shell's meta-delivered CSP supports. */
  readonly directives: Readonly<Record<string, readonly string[]>>;
  /**
   * The Trusted Types directives that arm the frame lock (D-014). kehto 0.29.0
   * refuses directives outside its baseline, so they travel apart and the
   * mount plan appends them to kehto's policy.
   */
  readonly trustedTypes: typeof TRUSTED_TYPES_DIRECTIVES;
}

const ZERO_NETWORK_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'none'"],
  'script-src': ["'unsafe-inline'", "'wasm-unsafe-eval'"],
  'style-src': ["'unsafe-inline'"],
  'img-src': ['data:', 'blob:'],
  'font-src': ['data:'],
  'connect-src': ["'none'"],
  'worker-src': ["'none'"],
  'child-src': ["'none'"],
  'frame-src': ["'none'"],
  'media-src': ["'none'"],
  'object-src': ["'none'"],
  'manifest-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

/**
 * The CSP every applet frame receives.
 *
 * The profile is accepted so callers configure one place, but it changes
 * nothing: D-003 lets a user loosen limits and thresholds, never the sandbox.
 * A direct network path would bypass the consent, quota and revocation model
 * that every other mitigation depends on, so `connect-src` stays `'none'` and
 * the directives match kehto's zero-network baseline exactly. The Trusted
 * Types directives ride alongside, so no applet realm can mint a nested frame
 * (D-014).
 *
 * @param _profile - Ignored; present so the CSP is requested alongside the config.
 * @returns Connection grants (none), the directive source lists and the Trusted Types directives.
 * @example
 * ```ts
 * const csp = createAppletCsp('relaxed');
 * csp.connectOrigins; // []
 * csp.directives['connect-src']; // ["'none'"]
 * csp.trustedTypes; // "require-trusted-types-for 'script'; trusted-types default"
 * ```
 */
export function createAppletCsp(_profile: GuardProfile): AppletCsp {
  return { connectOrigins: [], directives: ZERO_NETWORK_DIRECTIVES, trustedTypes: TRUSTED_TYPES_DIRECTIVES };
}

/**
 * Serialise directives to a policy string for a `Content-Security-Policy` meta tag.
 *
 * @param directives - Directive name to source list.
 * @returns Semicolon-separated policy in directive order.
 * @example
 * ```ts
 * renderCsp({ 'default-src': ["'none'"], 'img-src': ['data:', 'blob:'] });
 * // "default-src 'none'; img-src data: blob:"
 * ```
 */
export function renderCsp(directives: Readonly<Record<string, readonly string[]>>): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}
