import type { ServiceHandler } from '@kehto/runtime';
import type { SoulseekClient } from '@kernlize/bridges';
import type { NappletMessage, SoulseekFailure, SoulseekInfo, SoulseekReleased } from '@napplet/core';
import {
  SoulseekFault,
  alive,
  createSoulseekQueries,
  onlyFields,
  textOf,
  type SoulseekCall,
  type SoulseekContext,
  type SoulseekLimits,
  type SoulseekSession,
} from './soulseek-queries.js';
import { createSoulseekTransfers } from './soulseek-transfers.js';
import type { DownloadQuestion, DownloadService, DownloadServiceDeps } from './types.js';

export type { SoulseekLimits } from './soulseek-queries.js';

/** What the `soulseek` service needs from the shell. */
export interface SoulseekServiceOptions extends DownloadServiceDeps {
  /** The person's Soulseek daemon, read on every request; undefined when none is set up. */
  readonly client: () => SoulseekClient | undefined;
  /** Runtime limits; each has the default in {@link DEFAULT_SOULSEEK_LIMITS}. */
  readonly limits?: Partial<SoulseekLimits>;
}

/**
 * The limits a window works within unless the host says otherwise.
 *
 * @example
 * ```ts
 * createSoulseekService({ ...deps, client, limits: { ...DEFAULT_SOULSEEK_LIMITS, maxTransfers: 4 } });
 * ```
 */
export const DEFAULT_SOULSEEK_LIMITS: SoulseekLimits = {
  maxQueries: 4,
  maxTransfers: 16,
  maxResults: 500,
  maxPageSize: 100,
  maxReadBytes: 65536,
  maxTextBytes: 1024,
  queryTimeoutMs: 30000,
  pollIntervalMs: 1000,
};

/**
 * What the person is asked before a window first reaches the network through their
 * daemon: who learns what, that nothing is private on the way, and when it ends.
 *
 * @example
 * ```ts
 * SOULSEEK_SESSION_QUESTION.title; // 'Search and download through your sharing program'
 * ```
 */
export const SOULSEEK_SESSION_QUESTION: DownloadQuestion = {
  kind: 'session',
  title: 'Search and download through your sharing program',
  lines: [
    { label: 'Who sees it', value: "The network's server and the people whose files are involved see your search words, the names of the files you ask for, and the network address of the machine running the program" },
    { label: 'Privacy', value: 'Nothing is encrypted end to end' },
    { label: 'Until', value: "Downloads stop when this applet's window closes" },
  ],
};

type Operation = (call: SoulseekCall, fields: Record<string, unknown>) => Promise<unknown>;

/** Marks a repeated request id, which is neither run again nor answered (NAP-SOULSEEK, Wire Protocol). */
const REPEATED = Symbol('repeated');

function failureOf(error: unknown): SoulseekFailure {
  if (error instanceof SoulseekFault) return { code: error.code, message: error.message };
  return { code: 'backend_error', message: 'The sharing program did not do what was asked' };
}

/**
 * The `soulseek` service: an applet searches, browses and downloads through the
 * Soulseek daemon the person already runs (NAP-SOULSEEK).
 *
 * Every handle belongs to the window it was issued to; another window, even of the
 * same applet, cannot tell one from a handle that never existed. The person is asked
 * once per window before it first reaches the network. Nothing outlives the window:
 * closing it, or taking its grant back, stops its searches and unfinished downloads
 * in the daemon and leaves finished files there, untouched.
 *
 * The daemon is a separate program whose files kernl cannot reach, so `read` is
 * `denied`, `save` is `unsupported` and `info` reports `canSave: false`. The runtime
 * checks the domain grant before a message gets here; this handler does not repeat it.
 *
 * @param options - The daemon, the person's consent, the clock and the limits.
 * @returns The handler to register as `soulseek`, and `dispose`.
 * @example
 * ```ts
 * const soulseek = createSoulseekService({ client: () => daemon, appletOf, ask, storage });
 * registry.soulseek = soulseek.handler;
 * ```
 */
export function createSoulseekService(options: SoulseekServiceOptions): DownloadService {
  const limits: SoulseekLimits = { ...DEFAULT_SOULSEEK_LIMITS, ...options.limits };
  const sessions = new Map<string, SoulseekSession>();
  const stateOf = (client: SoulseekClient): Promise<'offline' | 'online'> => client.state().catch(() => 'offline');
  const context: SoulseekContext = {
    limits,
    now: options.now ?? Date.now,
    async online(client) {
      if ((await stateOf(client)) !== 'online') throw new SoulseekFault('unavailable', 'The sharing program is not connected to its network');
    },
    async reach() {
      const client = options.client();
      if (!client) throw new SoulseekFault('unavailable', 'No sharing program is set up');
      await context.online(client);
      return client;
    },
    async consent(windowId, session) {
      if (session.approved) return;
      const asking = (session.asking ??= options.ask(windowId, SOULSEEK_SESSION_QUESTION).then(
        (yes) => yes,
        () => false,
      ));
      const yes = await asking;
      if (session.asking === asking) session.asking = undefined;
      alive(session);
      if (!yes) throw new SoulseekFault('denied', 'The person said no');
      session.approved = true;
    },
  };
  const queries = createSoulseekQueries(context);
  const transfers = createSoulseekTransfers(context);
  const operations = new Map<string, Operation>(
    Object.entries<Operation>({
      async info(_call, fields): Promise<SoulseekInfo> {
        onlyFields(fields, []);
        const client = options.client();
        return { state: client ? await stateOf(client) : 'unconfigured', canSave: false, ...limits };
      },
      async release({ session }, fields): Promise<SoulseekReleased> {
        onlyFields(fields, ['kind', 'handle']);
        const handle = textOf(fields.handle, 'handle', limits.maxTextBytes);
        if (fields.kind !== 'query' && fields.kind !== 'transfer') throw new SoulseekFault('invalid_request', 'kind must be "query" or "transfer"');
        return { released: await (fields.kind === 'query' ? queries : transfers).release(session, handle) };
      },
      search: queries.search,
      browse: queries.browse,
      results: queries.results,
      stop: queries.stop,
      download: transfers.download,
      transfers: transfers.transfers,
      status: transfers.status,
      pause: transfers.pause,
      resume: transfers.resume,
      cancel: transfers.cancel,
      read: transfers.read,
      save: transfers.save,
    }).map(([name, run]) => [`soulseek.${name}`, run]),
  );
  const sessionOf = (windowId: string): SoulseekSession => {
    let session = sessions.get(windowId);
    if (!session) {
      session = { closed: false, approved: false, asking: undefined, seen: new Set(), admissions: { tail: Promise.resolve() }, queries: new Map(), files: new Map(), transfers: new Map(), byFile: new Map() };
      sessions.set(windowId, session);
    }
    return session;
  };
  const accept = async (windowId: string, id: string, run: Operation, fields: Record<string, unknown>): Promise<unknown> => {
    if (!options.appletOf(windowId)) throw new SoulseekFault('denied', 'This window is not a running applet');
    textOf(id, 'id', limits.maxTextBytes);
    const session = sessionOf(windowId);
    if (session.seen.has(id)) return REPEATED;
    session.seen.add(id);
    return run({ windowId, session }, fields);
  };
  const end = (windowId: string): void => {
    const session = sessions.get(windowId);
    if (!session) return;
    sessions.delete(windowId);
    session.closed = true;
    for (const query of session.queries.values()) void queries.discard(session, query);
    for (const record of session.transfers.values()) void transfers.discard(session, record);
  };
  const dispose = (): void => {
    for (const windowId of sessions.keys()) end(windowId);
  };
  const handler: ServiceHandler = {
    descriptor: { name: 'soulseek', version: '1.0.0', description: "Searches and downloads through the person's own sharing program" },
    messageCapabilities: Object.fromEntries([...operations.keys()].map((type) => [type, null])),
    handleMessage(windowId, message, send) {
      const { type, id, ...fields } = message as { type: string; id?: unknown } & Record<string, unknown>;
      const run = operations.get(type);
      if (!run || typeof id !== 'string' || id === '') return;
      const reply = (body: { value: unknown } | { error: SoulseekFailure }): void => {
        const result: NappletMessage & Record<string, unknown> = { type: `${type}.result`, id, ...body };
        send(result);
      };
      void accept(windowId, id, run, fields).then(
        (value) => {
          if (value !== REPEATED) reply({ value });
        },
        (error: unknown) => reply({ error: failureOf(error) }),
      );
    },
    onWindowDestroyed: end,
    onPermissionRevoked: end,
    onUnregistered: dispose,
  };
  return { handler, dispose };
}
