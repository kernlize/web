import { auditTime, catchError, EMPTY, from, lastValueFrom, map, merge, mergeAll, scan, share, takeUntil, tap, timer, type Observable } from 'rxjs';
import type { Filter } from 'applesauce-core/helpers';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import { asFilters, type ApplesaucePool, type RelayTiers } from '@kernlize/kernel';
import { newestStacks, toAppletStack, STACK_KIND, type AppletStack } from './stack.js';

/**
 * The stacks people publish: NIP-51 app curation sets whose `a` tags name
 * napplet manifests. Read only; the shell opens a stack, it does not write one.
 */
export interface AppletStacks {
  /** List the stacks published to the shell's relays, newest first, once every relay has finished. */
  load(options?: LoadStacksOptions): Promise<readonly AppletStack[]>;
  /** The same list, emitted again as stacks arrive; completes when every relay has finished. */
  stream(options?: LoadStacksOptions): Observable<readonly AppletStack[]>;
}

/**
 * How many stacks the shell asks each relay for.
 *
 * @example
 * ```ts
 * await loadStacks(pool, tiers, { limit: STACK_LIMIT });
 * ```
 */
export const STACK_LIMIT = 500;

/**
 * The longest the launcher keeps listening to a relay that has not finished.
 *
 * @example
 * ```ts
 * streamStacks(pool, tiers, { timeoutMs: STACK_TIMEOUT_MS }); // at most 30 s
 * ```
 */
export const STACK_TIMEOUT_MS = 30_000;

/**
 * When an empty list is emitted if nothing has arrived; a moment to tell the
 * person, not a cut-off.
 *
 * @example
 * ```ts
 * streamStacks(pool, tiers, { settleMs: STACK_SETTLE_MS });
 * ```
 */
export const STACK_SETTLE_MS = 3000;

/**
 * How often, at most, the stream emits while stacks pour in.
 *
 * @example
 * ```ts
 * streamStacks(pool, tiers); // emits at most every STACK_EMIT_MS
 * ```
 */
export const STACK_EMIT_MS = 120;

/** Options for {@link loadStacks}. */
export interface LoadStacksOptions {
  /** Per-relay limit; {@link STACK_LIMIT} by default. */
  readonly limit?: number;
  /** The outer bound on a relay that never finishes; {@link STACK_TIMEOUT_MS} by default. */
  readonly timeoutMs?: number;
  /** How often the stream emits at most; {@link STACK_EMIT_MS} by default. */
  readonly emitMs?: number;
  /** When an empty list is emitted if nothing has arrived; {@link STACK_SETTLE_MS} by default. */
  readonly settleMs?: number;
  /** Stacks seen before, listed at once while the relays are asked for newer ones. */
  readonly cache?: (filters: Filter[]) => Promise<NostrEvent[]>;
  /** Where stacks from the relays are kept, so the event cache holds them for the next visit. */
  readonly store?: { add(event: NostrEvent): unknown };
}

/**
 * The relays stacks are read from: the applet relays, where the people who
 * publish applets write, then the public relays most people also write to.
 *
 * @param tiers - The shell's relay tiers.
 * @returns Deduplicated relay URLs.
 * @example
 * ```ts
 * stackRelays(tiers); // ['wss://relay.napplet.soy', 'wss://relay.damus.io', …]
 * ```
 */
export function stackRelays(tiers: RelayTiers): readonly string[] {
  const { apps, super: shared } = tiers.get();
  return Object.freeze([...new Set([...apps, ...shared])]);
}

function stackFilters(options: LoadStacksOptions): NostrFilter[] {
  return [{ kinds: [STACK_KIND], limit: options.limit ?? STACK_LIMIT }];
}

/**
 * Stream the stacks published to the shell's relays.
 *
 * Stacks are listed as each relay sends them, so the first relay to answer
 * fills the launcher while slower ones are still talking. A relay that fails
 * contributes nothing and never discards what others sent; when nothing has
 * arrived after `settleMs` an empty list says so, and listening goes on. A
 * stack republished empty is not listed (see {@link newestStacks}).
 *
 * @param pool - The shared applesauce pool.
 * @param tiers - The shell's relay tiers.
 * @param options - Limit, bounds and caching hooks.
 * @returns The growing list, one stack per `(publisher, d)`, newest first.
 * @example
 * ```ts
 * streamStacks(pool, tiers).subscribe((stacks) => render(stacks));
 * ```
 */
export function streamStacks(pool: ApplesaucePool, tiers: RelayTiers, options: LoadStacksOptions = {}): Observable<readonly AppletStack[]> {
  const relays = stackRelays(tiers);
  const filters = asFilters(stackFilters(options));
  const cached = options.cache ? from(options.cache(filters).catch(() => [])).pipe(mergeAll()) : EMPTY;
  const live = pool.request([...relays], filters).pipe(
    takeUntil(timer(options.timeoutMs ?? STACK_TIMEOUT_MS)),
    catchError(() => EMPTY),
    tap((event) => options.store?.add(event)),
  );
  const found = merge(cached, live).pipe(
    scan((stacks: readonly AppletStack[], event): readonly AppletStack[] => {
      const stack = toAppletStack(event);
      return stack ? [...stacks, stack] : stacks;
    }, Object.freeze([])),
  );
  const lists = found.pipe(auditTime(options.emitMs ?? STACK_EMIT_MS), map(newestStacks), share());
  const nothingYet = timer(options.settleMs ?? STACK_SETTLE_MS).pipe(map((): readonly AppletStack[] => Object.freeze([])), takeUntil(lists));
  return merge(nothingYet, lists);
}

/**
 * List the stacks published to the shell's relays, once every relay has
 * finished or the outer bound passed. Prefer {@link streamStacks} for a UI.
 *
 * @param pool - The shared applesauce pool.
 * @param tiers - The shell's relay tiers.
 * @param options - Limit, bounds and caching hooks.
 * @returns One stack per `(publisher, d)`, newest first.
 * @example
 * ```ts
 * const stacks = await loadStacks(pool, tiers);
 * ```
 */
export async function loadStacks(pool: ApplesaucePool, tiers: RelayTiers, options: LoadStacksOptions = {}): Promise<readonly AppletStack[]> {
  return lastValueFrom(streamStacks(pool, tiers, options), { defaultValue: Object.freeze([]) });
}
