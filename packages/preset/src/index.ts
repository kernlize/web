/**
 * kernl's preset: the module list kernl.run runs, over the kernel (D-068). Private until the
 * package split (#75) is published. It reads the modules from `@kernlize/core` until they move to
 * `@kernlize/modules`; then `@kernlize/core` re-exports the preset instead.
 *
 * @packageDocumentation
 */
import { kernlModules } from '@kernlize/core';

export { createMemoryRelays, type MemoryRelays, type MemoryRelaysOptions, type RelaySocketConstructor } from './memory-relays.js';

/** The options kernl's own modules take, as `kernlModules` reads them. */
export type KernlPresetOptions = NonNullable<Parameters<typeof kernlModules>[0]>;

/**
 * The modules kernl.run composes: theme, profiles, people, social, messaging, directory,
 * mailboxes, files, settings, catalog, keys, intents, bridges, downloads, multiplayer and cache.
 *
 * @param options - Each module's options.
 * @returns The module list, typed so the shell gets each module's api.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: kernlPreset({ theme }) });
 * ```
 */
export function kernlPreset(options?: KernlPresetOptions): ReturnType<typeof kernlModules> {
  return kernlModules(options);
}
