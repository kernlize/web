// What @kernlize/core adds over the kernel and the modules. Each entry re-exports those two itself, because esbuild drops
// an external `export *` from a chunk two entries share (D-068).

/**
 * The npm package name, shared by both registry builds.
 *
 * @example
 * ```ts
 * PACKAGE_NAME; // '@kernlize/core'
 * ```
 */
export const PACKAGE_NAME = '@kernlize/core';

export type { Kernl, KernlMembers, KernlModuleOptionKeys, KernlModuleOptions, KernlOptions, ModuleMembers } from './kernl-members.js';
