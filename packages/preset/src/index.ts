/**
 * kernl's preset: the module list kernl.run runs over the kernel, `createKernl`, which composes
 * it when a host names no modules, and `previewPreset`, the same shell over parts that live in the
 * page (D-068). No package a host installs imports it.
 *
 * @packageDocumentation
 */
import { kernlModules } from './modules/default.js';

export { createKernl } from './create-kernl.js';
export { kernlModules } from './modules/default.js';
export type { Kernl, KernlMembers, KernlModuleOptionKeys, KernlModuleOptions, KernlOptions, ModuleMembers } from './kernl-members.js';

export { createMemoryRelays, type MemoryRelays, type MemoryRelaysOptions, type RelaySocketConstructor } from './memory-relays.js';
export { previewPreset, shippedSamples, type PreviewKernlOptions, type PreviewModules, type PreviewPreset, type PreviewPresetOptions, type PreviewSample, type ShippedSamples } from './preview/preset.js';
export { PREVIEW_CORRESPONDENTS, PREVIEW_REPLIES } from './preview/correspondents.js';

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
