import type { Theme } from '@napplet/nap/theme/types';
import type { EventCacheOpener } from '../cache/connect.js';
import { cacheModule } from './cache.js';
import { directoryModule } from './directory.js';
import { filesModule } from './files.js';
import { mailboxesModule } from './mailboxes.js';
import { peopleModule } from './people.js';
import { profilesModule } from './profiles.js';
import { socialModule } from './social.js';
import { themeModule } from './theme.js';

/**
 * kernl's own module list, which `createKernl` loads when a host names none (D-061). A host that
 * wants kernl's opinions and one of its own spreads this list and adds to it.
 *
 * @param options - The theme pushed to applets and the event cache's opener.
 * @returns The theme, profiles, people, social, directory, mailboxes, files and cache modules, in that order.
 * @example
 * ```ts
 * createKernl({ host, modules: [...kernlModules({ theme }), myModule] });
 * ```
 */
export function kernlModules(options: { readonly theme?: Theme; readonly eventCache?: EventCacheOpener } = {}): readonly [ReturnType<typeof themeModule>, ReturnType<typeof profilesModule>, ReturnType<typeof peopleModule>, ReturnType<typeof socialModule>, ReturnType<typeof directoryModule>, ReturnType<typeof mailboxesModule>, ReturnType<typeof filesModule>, ReturnType<typeof cacheModule>] {
  return [themeModule(options.theme), profilesModule(), peopleModule(), socialModule(), directoryModule(), mailboxesModule(), filesModule(), cacheModule(options.eventCache)];
}
