import type { ConfigServiceOptions, ConfigSettingsContext } from '@kehto/services';
import type { StorageLike } from '../types.js';
import { createNamespacedStore } from '../persistence/store.js';

/** What the host shows when an applet asks for its settings. */
export interface SettingsPrompt {
  /** The applet's title, for the heading. */
  readonly title: string;
  /** The section the applet asked to open, if any. */
  readonly section?: string;
  /** The accepted schema, the current values and the commit that validates, saves and tells the applet. */
  readonly context: ConfigSettingsContext;
}

/** Options for {@link createAppletConfig}. */
export interface AppletConfigOptions {
  readonly storage: StorageLike;
  /** The applet a window runs, as a key that stays the same across its versions, with its title; none for an unknown window. */
  readonly appletOf: (windowId: string) => { readonly key: string; readonly title: string } | undefined;
  /** Shows the settings form. */
  readonly present: (prompt: SettingsPrompt) => void;
}

const STORAGE_KEY = 'applet-config:v1';

/**
 * kernl's NAP-CONFIG hooks for kehto's `createConfigService`: an applet's
 * settings, as the person set them in a form the shell draws from the
 * applet's schema. kehto validates the schema and every value. kernl keeps
 * the values per applet, not per version, so an update keeps them, and only
 * the shell's form ever writes them (D-036).
 *
 * @param options - Storage, the window-to-applet lookup and the form.
 * @returns Options for `createConfigService`.
 * @example
 * ```ts
 * registry.config = createConfigService(createAppletConfig({ storage, appletOf, present: host.presentSettings })).handler;
 * ```
 */
export function createAppletConfig(options: AppletConfigOptions): ConfigServiceOptions {
  const store = createNamespacedStore(options.storage, 'kernl');
  const read = (): Record<string, Record<string, unknown>> => store.getJson(STORAGE_KEY, {});
  return {
    getValues(windowId) {
      const applet = options.appletOf(windowId);
      return applet ? { ...read()[applet.key] } : {};
    },
    saveValues(windowId, values) {
      const applet = options.appletOf(windowId);
      if (applet) store.setJson(STORAGE_KEY, { ...read(), [applet.key]: values });
    },
    openSettings(windowId, section, context) {
      const applet = options.appletOf(windowId);
      if (applet) options.present({ title: applet.title, ...(section ? { section } : {}), context });
    },
  };
}
