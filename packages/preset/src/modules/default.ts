import type { Theme } from '@napplet/nap/theme/types';
import { cacheModule, directoryModule, filesModule, catalogModule, keysModule, intentsModule, bridgesModule, downloadsModule, multiplayerModule, messagingModule, legacyDm, privateDm, settingsModule, mailboxesModule, peopleModule, profilesModule, socialModule, themeModule, type EventCacheOpener, type MultiplayerModuleOptions, type MessagingModuleOptions, type ShortcutSettings } from '@kernlize/modules';
import { ratchet } from '@kernlize/modules/messaging/ratchet';
import { groups } from '@kernlize/modules/messaging/groups';
import type { DownloadsOptions, SettingsPrompt } from '@kernlize/kernel';
import type { BridgeRegistry, TorrentBackend } from '@kernlize/bridges';

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
