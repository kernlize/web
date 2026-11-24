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
import { multiplayerModule, type MultiplayerModuleOptions } from './multiplayer.js';
import { messagingModule, type MessagingModuleOptions } from './messaging.js';
import { legacyDm, privateDm } from '../messaging/providers.js';
import { ratchet } from '../messaging/ratchet/index.js';
import { groups } from '../messaging/groups/index.js';
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
 * @param options - The theme pushed to applets, the event cache's opener, the host's settings form, its reserved shortcuts, and its messaging providers or registry (all four of kernl's by default).
 * @returns The theme, profiles, people, social, messaging, directory, mailboxes, files, settings, catalog, keys, intents, bridges, downloads, multiplayer and cache modules, in that order.
 * @example
 * ```ts
 * createKernl({ host, modules: [...kernlModules({ theme }), myModule] });
 * ```
 */
export function kernlModules(options: { readonly theme?: Theme; readonly eventCache?: EventCacheOpener; readonly presentSettings?: (prompt: SettingsPrompt) => void; readonly shortcuts?: ShortcutSettings; readonly intentRetry?: { readonly intervalMs: number; readonly attempts: number }; readonly bridges?: BridgeRegistry; readonly torrent?: TorrentBackend; readonly downloads?: DownloadsOptions; readonly messaging?: MessagingModuleOptions } & MultiplayerModuleOptions = {}): readonly [ReturnType<typeof themeModule>, ReturnType<typeof profilesModule>, ReturnType<typeof peopleModule>, ReturnType<typeof socialModule>, ReturnType<typeof messagingModule>, ReturnType<typeof directoryModule>, ReturnType<typeof mailboxesModule>, ReturnType<typeof filesModule>, ReturnType<typeof settingsModule>, ReturnType<typeof catalogModule>, ReturnType<typeof keysModule>, ReturnType<typeof intentsModule>, ReturnType<typeof bridgesModule>, ReturnType<typeof downloadsModule>, ReturnType<typeof multiplayerModule>, ReturnType<typeof cacheModule>] {
  return [themeModule(options.theme), profilesModule(), peopleModule(), socialModule(), messagingModule(options.messaging ?? { providers: [privateDm(), legacyDm(), ratchet(), groups()] }), directoryModule(), mailboxesModule(), filesModule(), settingsModule(options.presentSettings), catalogModule(), keysModule(options.shortcuts), intentsModule(options.intentRetry ? { retry: options.intentRetry } : {}), bridgesModule({ ...(options.bridges ? { registry: options.bridges } : {}), ...(options.torrent ? { torrent: options.torrent } : {}) }), downloadsModule(options.downloads), multiplayerModule({ ...(options.remoteTools ? { remoteTools: options.remoteTools } : {}), ...(options.directConnections ? { directConnections: options.directConnections } : {}) }), cacheModule(options.eventCache)];
}
