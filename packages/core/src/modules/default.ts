import type { Theme } from '@napplet/nap/theme/types';
import { directoryModule } from './directory.js';
import { socialModule } from './social.js';
import { themeModule } from './theme.js';

/**
 * kernl's own module list, which `createKernl` loads when a host names none (D-061). A host that
 * wants kernl's opinions and one of its own spreads this list and adds to it.
 *
 * @param options - The theme pushed to applets.
 * @returns The theme, social and directory modules, in that order.
 * @example
 * ```ts
 * createKernl({ host, modules: [...kernlModules({ theme }), myModule] });
 * ```
 */
export function kernlModules(options: { readonly theme?: Theme } = {}): readonly [ReturnType<typeof themeModule>, ReturnType<typeof socialModule>, ReturnType<typeof directoryModule>] {
  return [themeModule(options.theme), socialModule(), directoryModule()];
}
