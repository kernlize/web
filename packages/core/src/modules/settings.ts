import { createConfigService } from '@kehto/services';
import { createAppletConfig, type SettingsPrompt } from '../applets/applet-config.js';
import type { KernlModule } from './module.js';

/**
 * Applets' own settings, the `config` domain (NAP-CONFIG, D-036). An applet registers a schema and
 * opens the form the host draws; values are kept per applet, across its versions, in the host's
 * storage. Without a form to draw, or without this module, `config` is not offered.
 *
 * @param present - Draws the settings form, usually the host's `presentSettings`.
 * @returns The module.
 * @example
 * ```ts
 * createKernl({ host, modules: [settingsModule((prompt) => host.presentSettings?.(prompt))] });
 * ```
 */
export function settingsModule(present?: (prompt: SettingsPrompt) => void): KernlModule<'settings'> {
  return {
    id: 'settings',
    setup(context) {
      if (!present) return {};
      const config = createAppletConfig({
        storage: context.storage,
        appletOf(windowId) {
          const summary = context.appletOf(windowId);
          return summary && { key: summary.manifest.catalogId, title: summary.title };
        },
        present,
      });
      return { services: { config: createConfigService(config).handler } };
    },
  };
}
