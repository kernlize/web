import type { Theme } from '@napplet/nap/theme/types';
import type { EventCacheOpener } from '../cache/connect.js';
import { cacheModule } from './cache.js';
import { directoryModule } from './directory.js';
import { filesModule } from './files.js';
import { catalogModule } from './catalog.js';
import { keysModule } from './keys.js';
import { intentsModule } from './intents.js';
import { bridgesModule } from './bridges.js';
import { downloadsModule } from './downloads.js';
import type { DownloadsOptions } from '../types.js';
import type { BridgeRegistry, TorrentBackend } from '@kernlize/bridges';
import type { ShortcutSettings } from '../keys/shortcuts.js';
import { settingsModule } from './settings.js';
import type { SettingsPrompt } from '../applets/applet-config.js';
import { mailboxesModule } from './mailboxes.js';
import { peopleModule } from './people.js';
import { profilesModule } from './profiles.js';
import { socialModule } from './social.js';
import { themeModule } from './theme.js';

/**
 * kernl's own module list, which `createKernl` loads when a host names none (D-061). A host that
 * wants kernl's opinions and one of its own spreads this list and adds to it.
 *
 * @param options - The theme pushed to applets, the event cache's opener, the host's settings form and its reserved shortcuts.
 * @returns The theme, profiles, people, social, directory, mailboxes, files, settings, catalog, keys, intents, bridges, downloads and cache modules, in that order.
 * @example
 * ```ts
 * createKernl({ host, modules: [...kernlModules({ theme }), myModule] });
 * ```
 */
export function kernlModules(options: { readonly theme?: Theme; readonly eventCache?: EventCacheOpener; readonly presentSettings?: (prompt: SettingsPrompt) => void; readonly shortcuts?: ShortcutSettings; readonly intentRetry?: { readonly intervalMs: number; readonly attempts: number }; readonly bridges?: BridgeRegistry; readonly torrent?: TorrentBackend; readonly downloads?: DownloadsOptions } = {}): readonly [ReturnType<typeof themeModule>, ReturnType<typeof profilesModule>, ReturnType<typeof peopleModule>, ReturnType<typeof socialModule>, ReturnType<typeof directoryModule>, ReturnType<typeof mailboxesModule>, ReturnType<typeof filesModule>, ReturnType<typeof settingsModule>, ReturnType<typeof catalogModule>, ReturnType<typeof keysModule>, ReturnType<typeof intentsModule>, ReturnType<typeof bridgesModule>, ReturnType<typeof downloadsModule>, ReturnType<typeof cacheModule>] {
  return [themeModule(options.theme), profilesModule(), peopleModule(), socialModule(), directoryModule(), mailboxesModule(), filesModule(), settingsModule(options.presentSettings), catalogModule(), keysModule(options.shortcuts), intentsModule(options.intentRetry ? { retry: options.intentRetry } : {}), bridgesModule({ ...(options.bridges ? { registry: options.bridges } : {}), ...(options.torrent ? { torrent: options.torrent } : {}) }), downloadsModule(options.downloads), cacheModule(options.eventCache)];
}
