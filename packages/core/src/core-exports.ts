// What @kernlize/core adds over the kernel, the modules and the preset: its own name. Each entry re-exports those packages
// itself, because esbuild drops an external `export *` from a chunk two entries share (D-068).

/**
 * The npm package name, shared by both registry builds.
 *
 * @example
 * ```ts
 * PACKAGE_NAME; // '@kernlize/core'
 * ```
 */
export const PACKAGE_NAME = '@kernlize/core';

