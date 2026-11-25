/**
 * kernl's preset: the module list kernl.run runs over the kernel, and `createKernl`, which composes
 * it when a host names no modules (D-068). No package a host installs imports it.
 *
 * @packageDocumentation
 */
import { kernlModules } from './modules/default.js';

export { createKernl } from './create-kernl.js';
export { kernlModules } from './modules/default.js';
export type { Kernl, KernlMembers, KernlModuleOptionKeys, KernlModuleOptions, KernlOptions, ModuleMembers } from './kernl-members.js';

/** The options kernl's own modules take, as `kernlModules` reads them. */
export type KernlPresetOptions = NonNullable<Parameters<typeof kernlModules>[0]>;

/**
 * The modules kernl.run composes: theme, profiles, people, social, messaging, directory,
 * mailboxes, files, settings, catalog, stacks, keys, gamepad, intents, bridges, downloads, multiplayer and cache.
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
