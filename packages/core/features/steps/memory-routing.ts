import { DOWNLOAD_PROGRAMS, type ConnectionRouting, type DownloadConnection, type DownloadProgram } from '@kernlize/core';

/** The id the one connection of a memory routing has, which stored jobs in scenarios name. */
export const MEMORY_CONNECTION = 'memory';

/** One connection over an in-memory client, serving while `client` returns one: the routing a service reads, without a store. */
export function memoryRouting<T>(client: () => T | undefined, program: DownloadProgram): ConnectionRouting<T> {
  const connection: DownloadConnection = {
    id: MEMORY_CONNECTION,
    program,
    label: DOWNLOAD_PROGRAMS[program].name,
    url: DOWNLOAD_PROGRAMS[program].example,
    hasPassword: false,
    hasApiKey: false,
    routingKey: `${MEMORY_CONNECTION}:0`,
  };
  const all = () => {
    const live = client();
    return live === undefined ? [] : [{ connection, client: live }];
  };
  return { all, byId: (id) => all().find((routed) => routed.connection.id === id), preferred: () => all()[0] };
}
