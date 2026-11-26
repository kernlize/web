import type { ConnectedEventCache } from '../cache/connect.js';
import { loadStacks, streamStacks, type AppletStacks, type LoadStacksOptions } from '../stacks/fetch.js';
import type { KernlModule } from '@kernlize/kernel';

/**
 * Published applet stacks over the shell's shared relay pool and event store (D-071).
 * The optional cache module supplies stacks from an earlier visit.
 *
 * @returns The module; its api is the `AppletStacks`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [stacksModule()] });
 * kernl.stacks.stream().subscribe(render);
 * ```
 */
export function stacksModule(): KernlModule<'stacks', AppletStacks> {
  return {
    id: 'stacks',
    setup(context) {
      const cached: Pick<LoadStacksOptions, 'cache' | 'store'> = {
        store: context.eventStore,
        // Read when stacks are listed, so the cache module may be loaded after this one, or not at all.
        cache: (filters) => context.find<ConnectedEventCache>('cache')?.cacheRequest(filters) ?? Promise.resolve([]),
      };
      return {
        api: {
          load: (options) => loadStacks(context.pool, context.tiers, { ...cached, ...options }),
          stream: (options) => streamStacks(context.pool, context.tiers, { ...cached, ...options }),
        },
      };
    },
  };
}
