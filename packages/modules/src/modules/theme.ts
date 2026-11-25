import { createThemeService } from '@kehto/services';
import type { Theme } from '@napplet/nap/theme/types';
import type { KernlModule } from '@kernlize/kernel';

/**
 * What the shell may do with the `theme` domain: tell the applets that are open the colours
 * changed. The publish is kehto's own, so the theme an applet is answered with and the one it is
 * pushed are the same, and an applet opened after the change is told the new palette by
 * `theme.get` (D-064).
 */
export interface ThemeApi {
  /**
   * Tell every applet that holds `theme:read` the colours changed, and answer `theme.get` with
   * them from now on. An applet without the capability, or no longer bound, is not told.
   *
   * @param theme - The palette in force; a partial one falls back to kehto's default.
   * @example
   * ```ts
   * kernl.theme.publish({ colors: { background: '#f5f1e8', text: '#15171b', primary: '#9a5b00' } });
   * ```
   */
  publish(theme: Theme): void;
}

/**
 * The `theme` domain: the colours applets that hold `theme:read` are told. Without this module a
 * shell does not offer `theme`, and it leaves the baseline every applet starts with (D-061). Its
 * api publishes a change to the applets that are open, which is how a shell that follows the
 * person's colour scheme keeps them matching it (D-064).
 *
 * @param theme - The theme pushed to applets; kehto's default when left out.
 * @returns The module, whose api is `kernl.theme`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [themeModule({ colors: { background: '#000', text: '#fff', primary: '#7aa2f7' } }), socialModule()] });
 * kernl.theme.publish({ colors: { background: '#111', text: '#eee', primary: '#7aa2f7' } });
 * ```
 */
export function themeModule(theme?: Theme): KernlModule<'theme', ThemeApi> {
  return {
    id: 'theme',
    setup: () => {
      const service = createThemeService(theme ? { initialTheme: theme } : {});
      return {
        services: { theme: service.handler },
        api: { publish: (next: Theme) => void service.publishTheme(next) },
      };
    },
  };
}
