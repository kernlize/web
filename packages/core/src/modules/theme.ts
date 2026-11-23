import { createThemeService } from '@kehto/services';
import type { Theme } from '@napplet/nap/theme/types';
import type { KernlModule } from './module.js';

/**
 * The `theme` domain: the colours applets that hold `theme:read` are told. Without this module a
 * shell does not offer `theme`, and it leaves the baseline every applet starts with (D-061).
 *
 * @param theme - The theme pushed to applets; kehto's default when left out.
 * @returns The module.
 * @example
 * ```ts
 * createKernl({ host, modules: [themeModule({ colors: { background: '#000', text: '#fff', primary: '#7aa2f7' } }), socialModule()] });
 * ```
 */
export function themeModule(theme?: Theme): KernlModule<'theme'> {
  return {
    id: 'theme',
    setup: () => ({ services: { theme: createThemeService(theme ? { initialTheme: theme } : {}).handler } }),
  };
}
