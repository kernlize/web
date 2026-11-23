import { createPeople, type People, type PeopleOptions } from '../people/person.js';
import type { KernlModule } from './module.js';

/**
 * Reading a person from any form of their identity, asking the servers it names first:
 * `kernl.people`. Applets name people in any form only while it is loaded; without it, only a
 * hex key is taken.
 *
 * @param options - The outer bound on waiting for the hinted servers.
 * @returns The module; its api is `People`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [peopleModule()] });
 * await kernl.people.locate('npub1…');
 * ```
 */
export function peopleModule(options: Pick<PeopleOptions, 'timeoutMs'> = {}): KernlModule<'people', People> {
  return {
    id: 'people',
    setup: (context) => ({ api: createPeople({ ...options, store: context.eventStore, pool: context.pool }) }),
  };
}
