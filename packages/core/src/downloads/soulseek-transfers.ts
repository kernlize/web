import type { SoulseekClientFailure, SoulseekClientTransfer } from '@kernlize/bridges';
import type { SoulseekErrorCode, SoulseekSaved, SoulseekTransfer, SoulseekTransferState } from '@napplet/core';
import {
  SoulseekFault,
  admitSoulseekWork,
  alive,
  byteCountOf,
  ignore,
  integerOf,
  issueSoulseekHandle,
  onRoute,
  onlyFields,
  SOULSEEK_GONE,
  serial,
  textOf,
  within,
  type SoulseekCall,
  type SoulseekContext,
  type SoulseekSession,
  type SoulseekTransferRecord,
} from './soulseek-queries.js';

const TERMINAL: ReadonlySet<SoulseekTransferState> = new Set(['complete', 'cancelled', 'failed']);
const ACTIVE: ReadonlySet<SoulseekTransferState> = new Set(['queued', 'transferring']);
const UNREACHABLE = 'The sharing program could not be reached';
const FAILURE_WORDS: Record<SoulseekClientFailure, string> = {
  peer_unavailable: 'That person could not be reached',
  peer_denied: 'That person refused to send the file',
  timeout: 'The download took too long to start',
  limit_exceeded: 'The sharing program had no room for the download',
  backend_error: 'The sharing program could not finish the download',
};

/** The transfer operations of the service, plus what teardown needs. */
export interface SoulseekTransfers {
  download(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekTransfer>;
  transfers(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekTransfer[]>;
  status(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekTransfer>;
  pause(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekTransfer>;
  resume(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekTransfer>;
  cancel(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekTransfer>;
  read(call: SoulseekCall, fields: Record<string, unknown>): Promise<never>;
  save(call: SoulseekCall, fields: Record<string, unknown>): Promise<SoulseekSaved>;
  /** Resolves false when the window holds no such transfer. */
  release(session: SoulseekSession, handle: string): Promise<boolean>;
  /** Removes the transfer now, then cancels and removes it in the daemon unless it finished. */
  discard(session: SoulseekSession, record: SoulseekTransferRecord): Promise<void>;
}

function fail(record: SoulseekTransferRecord, code: SoulseekErrorCode, message: string): void {
  record.state = 'failed';
  record.progress = {};
  record.ending = { error: { code, message } };
}

function finished(record: SoulseekTransferRecord): void {
  if (record.state !== 'complete') throw new SoulseekFault('invalid_state', 'The download has not finished');
}

function retryable(record: SoulseekTransferRecord): void {
  if (TERMINAL.has(record.state)) throw new SoulseekFault('invalid_state', 'The download has ended; release it and ask for the file again');
}

/** Plain words for a failed call to the daemon: that its connection is gone, or that it could not be reached. */
const wordsOf = (error: unknown): string => (error instanceof SoulseekFault ? error.message : UNREACHABLE);

/** Resolves false, with the transfer failed, when the daemon did not confirm the stop. */
function halt(context: SoulseekContext, record: SoulseekTransferRecord, remove: boolean): Promise<boolean> {
  return onRoute(context, record.route, (client) => client.cancel(record.file.username, record.daemonId, remove)).then(
    () => true,
    (error: unknown) => {
      fail(record, 'backend_error', wordsOf(error));
      return false;
    },
  );
}

/** Cancels and removes what kernl put in the daemon for a transfer, unless it finished, is already gone, or its connection is. */
async function drop(context: SoulseekContext, record: SoulseekTransferRecord): Promise<void> {
  if (!record.inDaemon) return;
  await onRoute(context, record.route, (client) => client.cancel(record.file.username, record.daemonId, true)).then(() => {
    record.inDaemon = false;
  }, ignore);
}

function observe(record: SoulseekTransferRecord, seen: SoulseekClientTransfer): void {
  const size = BigInt(record.file.size);
  const got = BigInt(seen.received);
  record.received = got > size ? record.file.size : seen.received;
  if (seen.state === 'failed') return fail(record, seen.failure ?? 'backend_error', FAILURE_WORDS[seen.failure ?? 'backend_error']);
  if (seen.state === 'complete' && got !== size) return fail(record, 'backend_error', 'The sharing program ended the download without the whole file');
  record.state = seen.state;
  record.progress = {};
  // A finished file belongs to the person: nothing kernl does later may touch it in the daemon.
  if (seen.state === 'complete') record.inDaemon = false;
  if (seen.state === 'cancelled') record.received = '0';
  if (seen.state === 'queued' && seen.queuePosition !== undefined && seen.queuePosition > 0) record.progress = { queuePosition: seen.queuePosition };
  if (seen.state === 'transferring' && seen.bytesPerSecond !== undefined) record.progress = { bytesPerSecond: seen.bytesPerSecond };
}

/** Reads a running transfer's progress from the daemon, when a look is due. */
async function refresh(context: SoulseekContext, record: SoulseekTransferRecord): Promise<void> {
  const now = context.now();
  if (!ACTIVE.has(record.state) || now - record.polledAt < context.limits.pollIntervalMs) return;
  record.polledAt = now;
  const answer = await onRoute(context, record.route, (client) => client.transfer(record.file.username, record.daemonId)).then(
    (seen) => ({ seen }),
    (error: unknown) => ({ lost: wordsOf(error) }),
  );
  if ('lost' in answer) return fail(record, 'backend_error', answer.lost);
  if (!answer.seen) {
    record.inDaemon = false;
    return fail(record, 'backend_error', 'The sharing program no longer has this download');
  }
  if (answer.seen.size !== record.file.size) {
    fail(record, 'source_changed', 'The file is not the size it was listed with');
    return drop(context, record);
  }
  observe(record, answer.seen);
}

/** The daemon cannot pause, so a resume asks it for the same file again and forgets the stopped attempt. */
async function requeue(context: SoulseekContext, record: SoulseekTransferRecord): Promise<void> {
  const client = context.clientOf(record.route);
  if (!client) return fail(record, 'backend_error', SOULSEEK_GONE);
  await context.online(client);
  const { username, path, size } = record.file;
  const previous = record.daemonId;
  const next = await client.download({ username, path, size }).catch(ignore);
  if (!next) return fail(record, 'backend_error', UNREACHABLE);
  record.daemonId = next.id;
  record.state = 'queued';
  record.polledAt = context.now();
  if (next.id !== previous) await client.cancel(username, previous, true).catch(ignore);
}

function discard(context: SoulseekContext, session: SoulseekSession, record: SoulseekTransferRecord): Promise<void> {
  session.transfers.delete(record.id);
  session.byFile.delete(record.file.fileId);
  record.released = true;
  return serial(record, () => drop(context, record));
}

/**
 * The transfer half of the `soulseek` service: downloads the person's daemon carries
 * out, each bound to the file handle it was asked for and the window that asked.
 *
 * The daemon is somewhere kernl cannot read files from, so `read` is `denied` and
 * `save` is `unsupported`; a finished file stays in the daemon. The daemon cannot
 * pause, so a pause cancels there and a resume asks for the same file again.
 *
 * @param context - Limits, clock, the daemon and the person's consent.
 * @returns The transfer operations, and release.
 * @example
 * ```ts
 * const transfers = createSoulseekTransfers(context);
 * const transfer = await transfers.download(call, { fileId });
 * ```
 */
export function createSoulseekTransfers(context: SoulseekContext): SoulseekTransfers {
  const { limits } = context;
  const snapshot = (record: SoulseekTransferRecord): SoulseekTransfer => ({
    transferId: record.id,
    file: record.file,
    state: record.state,
    maxReadBytes: limits.maxReadBytes,
    received: record.received,
    ...record.progress,
    ...record.ending,
  });
  const find = (session: SoulseekSession, fields: Record<string, unknown>): SoulseekTransferRecord => {
    const record = session.transfers.get(textOf(fields.transferId, 'transferId', limits.maxTextBytes));
    if (!record) throw new SoulseekFault('not_found', 'Transfer handle is unavailable');
    return record;
  };
  const owned = (session: SoulseekSession, fields: Record<string, unknown>): SoulseekTransferRecord => {
    onlyFields(fields, ['transferId']);
    return find(session, fields);
  };
  return {
    async download(call, fields) {
      const { session } = call;
      onlyFields(fields, ['fileId']);
      const fileId = textOf(fields.fileId, 'fileId', limits.maxTextBytes);
      const entry = session.files.get(fileId);
      if (!entry) throw new SoulseekFault('not_found', 'File handle is unavailable');
      const existing = session.byFile.get(fileId);
      if (existing) return snapshot(existing);
      // A file is downloaded from the connection its query was made on, never the person's current default.
      return admitSoulseekWork(context, call, async (client, route) => {
        alive(session, session.files.get(fileId) !== entry);
        const admitted = session.byFile.get(fileId);
        if (admitted) return snapshot(admitted);
        if (session.transfers.size >= limits.maxTransfers) throw new SoulseekFault('limit_exceeded', `This window already holds ${limits.maxTransfers} downloads; release one first`);
        const { username, path, size } = entry.file;
        const { id } = await client.download({ username, path, size });
        if (session.closed || session.files.get(fileId) !== entry) {
          await client.cancel(username, id, true).catch(ignore);
          alive(session, true);
        }
        const record: SoulseekTransferRecord = { id: issueSoulseekHandle('t'), file: entry.file, route, daemonId: id, inDaemon: true, state: 'queued', received: '0', progress: {}, ending: {}, polledAt: context.now(), released: false, tail: Promise.resolve() };
        session.transfers.set(record.id, record);
        session.byFile.set(fileId, record);
        return snapshot(record);
      }, entry.query.route);
    },
    async transfers({ session }, fields) {
      onlyFields(fields, []);
      await Promise.all([...session.transfers.values()].map((record) => serial(record, () => refresh(context, record))));
      alive(session);
      return [...session.transfers.values()].map(snapshot);
    },
    async status({ session }, fields) {
      const record = owned(session, fields);
      return within(session, record, async () => {
        await refresh(context, record);
        return snapshot(record);
      });
    },
    async pause({ session }, fields) {
      const record = owned(session, fields);
      return within(session, record, async () => {
        retryable(record);
        if (record.state !== 'paused' && (await halt(context, record, false))) {
          record.state = 'paused';
          record.progress = {};
        }
        return snapshot(record);
      });
    },
    async resume({ session }, fields) {
      const record = owned(session, fields);
      return within(session, record, async () => {
        retryable(record);
        if (record.state === 'paused') await requeue(context, record);
        return snapshot(record);
      });
    },
    async cancel({ session }, fields) {
      const record = owned(session, fields);
      return within(session, record, async () => {
        if (!TERMINAL.has(record.state) && (await halt(context, record, true))) {
          record.state = 'cancelled';
          record.received = '0';
          record.progress = {};
          record.inDaemon = false;
        }
        return snapshot(record);
      });
    },
    async read({ session }, fields) {
      onlyFields(fields, ['transferId', 'offset', 'length']);
      const offset = byteCountOf(fields.offset, 'offset');
      integerOf(fields.length, 'length', [1, limits.maxReadBytes]);
      const record = find(session, fields);
      if (BigInt(offset) > BigInt(record.file.size)) throw new SoulseekFault('invalid_request', 'offset is past the end of the file');
      finished(record);
      throw new SoulseekFault('denied', 'kernl cannot read what the sharing program downloaded; the file is in that program');
    },
    async save({ session }, fields) {
      finished(owned(session, fields));
      throw new SoulseekFault('unsupported', 'kernl cannot save what the sharing program downloaded; the file is in that program');
    },
    async release(session, handle) {
      const record = session.transfers.get(handle);
      if (record) await discard(context, session, record);
      return record !== undefined;
    },
    discard: (session, record) => discard(context, session, record),
  };
}
