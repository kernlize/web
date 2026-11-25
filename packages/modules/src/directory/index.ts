/**
 * `@kernlize/modules/directory`: the directory module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export {
  DEFAULT_MONITOR_RELAYS,
  DEFAULT_SUGGESTIONS,
  createRelayDirectory,
  type DirectoryPool,
  type RelayDirectory,
  type RelayDirectoryOptions,
  type RelayListing,
  type SuggestOptions,
  type SuggestPurpose,
} from '../relays/directory.js';
export { directoryModule } from '../modules/directory.js';
