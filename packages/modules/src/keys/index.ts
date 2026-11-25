/**
 * `@kernlize/modules/keys`: the keys module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export { keysModule } from '../modules/keys.js';
export { createShortcutsService, type ShortcutKey, type ShortcutSettings, type ShortcutsOptions, type ShortcutsService } from '../keys/shortcuts.js';
