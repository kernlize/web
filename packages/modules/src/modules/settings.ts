import { createConfigService } from '@kehto/services';
import { createAppletConfig, type SettingsPrompt, type KernlModule } from '@kernlize/kernel';

/**
 * Applets' own settings, the `config` domain (NAP-CONFIG, D-036). An applet registers a schema and
 * opens the form the host draws; values are kept per applet, across its versions, in the host's
 * storage. The form is a `settings.present` ask the host draws (D-067). Without a form to draw, or
 * without this module, `config` is not offered.
 *
 * @param present - Draws the settings form instead of the host's `settings.present` renderer.
 * @returns The module.
 * @example
 * ```ts
 * createKernel({ host: { ...host, asks: { 'settings.present': (ask) => drawSettings(ask.facts) } }, modules: [settingsModule()] });
 * ```
 */
export function settingsModule(present?: (prompt: SettingsPrompt) => void): KernlModule<'settings'> {
  return {
    id: 'settings',
    asks: ['settings.present'],
    setup(context) {
      const draw = present ?? (context.canAsk('settings.present') ? (prompt: SettingsPrompt) => void context.ask({ kind: 'settings.present', facts: prompt, defaultText: { title: prompt.title } }) : undefined);
      if (!draw) return {};
      const config = createAppletConfig({
        storage: context.storage,
        appletOf(windowId) {
          const summary = context.appletOf(windowId);
          return summary && { key: summary.manifest.catalogId, title: summary.title };
        },
        present: draw,
      });
      return { services: { config: createConfigService(config).handler } };
    },
  };
}
