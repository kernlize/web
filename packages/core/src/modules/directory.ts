import { createRelayDirectory, type RelayDirectory, type RelayDirectoryOptions } from '../relays/directory.js';
import type { KernlModule } from './module.js';

/**
 * The relay directory: servers the monitors report on, for suggestions and search (D-029). It
 * waits for `start()`, and suggests the well-known servers until it has heard enough. Without
 * it the shell has no `kernl.directory`, and an account with no relay list is offered the
 * well-known servers only.
 *
 * @param options - Where the reports come from and how they are kept; the shell's pool is used.
 * @returns The module; its api is the `RelayDirectory`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [directoryModule({ relays: ['wss://monitor.example'] })] });
 * kernl.directory.start();
 * ```
 */
export function directoryModule(options: Omit<RelayDirectoryOptions, 'pool'> = {}): KernlModule<'directory', RelayDirectory> {
  return {
    id: 'directory',
    setup(context) {
      const directory = createRelayDirectory({ ...options, pool: context.pool });
      return { api: directory, dispose: () => directory.stop() };
    },
  };
}
