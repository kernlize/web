import type { NappletMessage } from '@napplet/core';
import { createNamespacedStore } from '../persistence/store.js';
import { createNzbHandles } from './nzb-handles.js';
import { addNzb, controlNzb } from './nzb-mutations.js';
import { describeNzbDownloaders, listNzbJobs, nzbFiles, nzbStatus } from './nzb-queries.js';
import { createNzbReplay } from './nzb-replay.js';
import { readNzbEnvelope } from './nzb-requests.js';
import { nzbFaultOf, type NzbCall, type NzbServiceOptions, type NzbSession } from './nzb-session.js';
import { need, type NzbError } from './nzb-wire.js';
import type { DownloadService } from './types.js';

export { readNzbDocument, type NzbDocument } from './nzb-document.js';
export type { NzbDownloader, NzbServiceOptions } from './nzb-session.js';

/** NAP-NZB, Shell Behavior: outstanding work is bounded; a window with this many requests waiting is told `rate_limited`. */
const MAX_WAITING = 16;
const REVOKED: NzbError = { code: 'permission_denied', message: 'This applet may no longer use downloads' };

type Answer = { readonly result: unknown } | { readonly error: NzbError };
type Reply = (answer: Answer) => void;

const OPERATIONS: Readonly<Record<string, (session: NzbSession, call: NzbCall, payload: unknown) => Promise<unknown>>> = {
  'nzb.downloaders': describeNzbDownloaders,
  'nzb.add': addNzb,
  'nzb.jobs': listNzbJobs,
  'nzb.status': nzbStatus,
  'nzb.control': controlNzb,
  'nzb.files': (session, call, payload) => nzbFiles(session, call, payload, false),
  'nzb.read': (session, call, payload) => nzbFiles(session, call, payload, true),
};

type Routable = NappletMessage & { readonly id: string };

/** NAP-NZB, Wire Protocol: only a known type with a nonempty text `id` is answered; anything else is ignored. */
const routable = (message: NappletMessage & { readonly id?: unknown }): message is Routable => Object.hasOwn(OPERATIONS, message.type) && typeof message.id === 'string' && message.id !== '';

function framed(message: Routable, body: Answer): NappletMessage {
  const result: Routable & Answer = { type: `${message.type}.result`, id: message.id, ...body };
  return result;
}

/**
 * The `nzb` service (NAP-NZB): applets hand NZB documents to the downloaders the
 * person already runs, and watch and steer the jobs they started.
 *
 * kernl is a remote control here. It never reads what a downloader saved, so `files`
 * and `read` are `unsupported` and every job says `canReadFiles: false`. The person is
 * asked before every add and before every delete. An applet sees only its own jobs,
 * under handles that mean nothing to anyone else. `add` and `control` are carried out
 * once per operation key, on a record that survives a reload. The runtime checks the
 * domain grant before a message gets here, so the handler does not check it again; it
 * declares every inbound type because `nzb` is not one of kehto's built-in domains.
 *
 * @param options - The downloaders, the optional fetcher, and the shell's applet, consent, storage and clock hooks.
 * @returns The handler to register as `nzb`, and `dispose`.
 * @example
 * ```ts
 * const nzb = createNzbService({ downloaders: () => [{ key: 'nzbget', label: 'Home', client }], appletOf, ownerOf, ask, storage: localStorage });
 * registry.nzb = nzb.handler;
 * ```
 */
export function createNzbService(options: NzbServiceOptions): DownloadService {
  const store = createNamespacedStore(options.storage, 'kernl');
  const clock = options.now ?? Date.now;
  const now = (): number => Math.floor(clock() / 1000);
  const lifetime = new AbortController();
  const turns = new Map<string, Promise<unknown>>();
  const waiting = new Map<string, Map<string, Reply>>();
  const session: NzbSession = {
    options,
    now,
    handles: createNzbHandles(store),
    replay: createNzbReplay(store, now),
    signal: lifetime.signal,
    inTurn(lane, work) {
      const run = (turns.get(lane) ?? Promise.resolve()).then(work);
      const settled = run.then(
        () => undefined,
        () => undefined,
      );
      turns.set(lane, settled);
      void settled.then(() => {
        if (turns.get(lane) === settled) turns.delete(lane);
      });
      return run;
    },
  };
  const answer = async (call: NzbCall, known: boolean, message: NappletMessage): Promise<Answer> => {
    need(known, 'permission_denied', 'Only a running applet may use downloads');
    const result = await (OPERATIONS[message.type] as (typeof OPERATIONS)[string])(session, call, readNzbEnvelope(message));
    // NAP-NZB, Shell Behavior: authorisation is checked again before anything is delivered.
    return call.live() ? { result } : { error: REVOKED };
  };
  return {
    handler: {
      descriptor: { name: 'nzb', version: '1.0.0', description: 'NZB downloads through the downloaders the person set up' },
      messageCapabilities: Object.fromEntries(Object.keys(OPERATIONS).map((type) => [type, null])),
      onPermissionDenied(_windowId, message, _reason, send) {
        if (routable(message)) send(framed(message, { error: { code: 'permission_denied', message: 'This applet may not use downloads' } }));
      },
      handleMessage(windowId, message, send) {
        if (!routable(message)) return;
        const { id } = message;
        const pending = waiting.get(windowId) ?? new Map<string, Reply>();
        if (pending.has(id)) return;
        const deliver = (body: Answer): void => send(framed(message, body));
        if (pending.size >= MAX_WAITING) {
          deliver({ error: { code: 'rate_limited', message: 'Too many requests are waiting; ask again when some have been answered' } });
          return;
        }
        const wanted = (): boolean => waiting.get(windowId)?.get(id) === reply;
        const reply: Reply = (body) => {
          if (!wanted()) return;
          pending.delete(id);
          deliver(body);
        };
        waiting.set(windowId, pending.set(id, reply));
        const applet = options.ownerOf(windowId);
        const call: NzbCall = { windowId, applet: applet ?? '', live: () => wanted() && options.ownerOf(windowId) === applet };
        void answer(call, applet !== undefined, message).then(reply, (error: unknown) => {
          const { code, message: words, replayUntil } = nzbFaultOf(error, false);
          reply({ error: { code, message: words, ...(replayUntil === undefined ? {} : { replayUntil }) } });
        });
      },
      onWindowDestroyed(windowId) {
        waiting.delete(windowId);
      },
      onPermissionRevoked(windowId) {
        for (const reply of waiting.get(windowId)?.values() ?? []) reply({ error: REVOKED });
      },
    },
    dispose() {
      lifetime.abort();
      waiting.clear();
    },
  };
}
