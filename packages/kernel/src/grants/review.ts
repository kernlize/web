import type { AppletIdentity, AppletSummary, Kernel, MountPlan } from '../types.js';

/** Lifecycle hooks for an artifact whose grants are being reviewed. */
export interface GrantReviewHost {
  plan(summary: AppletSummary, install?: boolean): Promise<MountPlan>;
  current(plan: MountPlan): boolean;
  domains(summary: AppletSummary): readonly string[];
  discardWaiting(plan: MountPlan): void;
  forgetIfIdle(identity: AppletIdentity): void;
}

const keyOf = (identity: AppletIdentity): string => `${identity.dTag}:${identity.hash}`;

/**
 * Hold a verified applet's temporary grants while its old window stops and its replacement opens.
 * A review never weakens revocation: it delays only the last-window cleanup of the grants record.
 *
 * @param host - The lifecycle that owns the plans, admissions, grants and windows.
 * @returns Its review scope and the last-window cleanup hook.
 * @example
 * ```ts
 * const reviews = createGrantReviews(host);
 * await reviews.withGrantReview(summary, async (start) => { await openAndMount(await start.plan()); });
 * ```
 */
export function createGrantReviews(host: GrantReviewHost): Pick<Kernel, 'withGrantReview'> & { ended(identity: AppletIdentity): void } {
  const holds = new Map<string, number>();
  const ended = (identity: AppletIdentity): void => {
    if (!holds.has(keyOf(identity))) host.forgetIfIdle(identity);
  };
  return {
    ended,
    async withGrantReview(summary, open) {
      const key = keyOf(summary.identity);
      holds.set(key, (holds.get(key) ?? 0) + 1);
      const owned: MountPlan[] = [];
      try {
        await open({
          plan: async (options) => {
            const plan = await host.plan(summary, options?.install);
            owned.push(plan);
            return plan;
          },
          canReuse(plan) {
            if (plan.summary.manifest.catalogId !== summary.manifest.catalogId || keyOf(plan.summary.identity) !== key || !host.current(plan)) return false;
            const domains = host.domains(summary);
            const startup = plan.environment.capabilities.domains;
            return domains.length === startup.length && domains.every((domain) => startup.includes(domain));
          },
        });
      } finally {
        for (const plan of owned) host.discardWaiting(plan);
        const remaining = holds.get(key)! - 1;
        if (remaining) holds.set(key, remaining);
        else holds.delete(key);
        ended(summary.identity);
      }
    },
  };
}
