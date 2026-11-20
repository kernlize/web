import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for NZBGet 26.3 that speaks its JSON-RPC interface over a real socket.
 *
 * Answers, field names and wording were copied from a real NZBGet 26.3 container: the
 * 401 for a wrong login, the `Invalid procedure` and `Invalid action` errors, the
 * `listgroups` and `history` entries of paused, queued, cancelled (`DELETED/MANUAL`),
 * duplicate (`DELETED/COPY`), unreadable (`FAILURE/SCAN`), failed (`FAILURE/HEALTH`)
 * and completed (`SUCCESS/HEALTH`) jobs, `append` answering -1 when it cannot write,
 * `editqueue` answering `true` for any job it finds, `HistoryRetryFailed` declining
 * without a word when the job's directory is gone, and the log lines. Post-processing
 * statuses and a directory that cannot be deleted were not seen there; those follow
 * NZBGet's source (`XmlRpc.cpp`, `HistoryCoordinator.cpp`).
 */

type Json = Record<string, unknown>;

/** A way for one method to go wrong that NZBGet's own logic would not produce on demand. */
export interface NzbgetFault {
  readonly method: string;
  readonly kind: 'answer' | 'hang-up' | 'silence';
  /** How many requests for the method go through untouched first. */
  skip?: number;
  readonly status?: number;
  readonly body?: string;
}

export interface NzbgetCall {
  readonly method: string;
  readonly params: readonly unknown[];
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface FakeNzbget {
  readonly url: string;
  readonly calls: NzbgetCall[];
  readonly faults: NzbgetFault[];
  readonly queue: Json[];
  readonly history: Json[];
  readonly log: Json[];
  readonly settings: Json[];
  /** Job directories that exist on its disk, by NZBID. */
  readonly directories: Set<number>;
  /** Directories it will fail to delete. */
  readonly stuck: Set<number>;
  /** `editqueue` commands it answers `true` to without doing anything. */
  readonly inert: Set<string>;
  login: { username: string; password: string } | undefined;
  /** `KeepHistory=0`: a removed job leaves no record. */
  keepsHistory: boolean;
  /** Whether it can write a submitted document to its disk. */
  canStore: boolean;
  /** Versions before 20 have no `GroupParkDelete` or `HistoryRetryFailed`. */
  parks: boolean;
  /** How many more `listgroups` answers still show a job that was just removed, as while its last articles arrive. */
  lingers: number;
  /** A job taken back from history fails again before anyone can look. */
  failsAtOnce: boolean;
  seedQueue(entry: Json): Json;
  /** Fills in the par, unpack and delete statuses NZBGet would have had to arrive at the given `Status`. */
  seedHistory(entry: Json): Json;
  close(): Promise<void>;
}

const VERSION = '26.3';

const DEFAULT_SETTINGS = [
  { Name: 'ConfigFile', Value: '/config/nzbget.conf' },
  { Name: 'Version', Value: VERSION },
  { Name: 'DestDir', Value: '/downloads/completed' },
  { Name: 'Category1.Name', Value: 'Movies' },
  { Name: 'Category1.DestDir', Value: '' },
  { Name: 'Category2.Name', Value: 'Series' },
  { Name: 'Category3.Name', Value: 'Music' },
  { Name: 'Category4.Name', Value: 'Software' },
  { Name: 'KeepHistory', Value: '30' },
];

function shared(id: number, name: string): Json {
  return {
    NZBID: id,
    NZBName: name,
    NZBNicename: name,
    Kind: 'NZB',
    URL: '',
    NZBFilename: `${name}.nzb`,
    DestDir: `/downloads/intermediate/${name}.#${id}`,
    FinalDir: '',
    Category: '',
    ParStatus: 'NONE',
    ExParStatus: 'NONE',
    UnpackStatus: 'NONE',
    MoveStatus: 'NONE',
    ScriptStatus: 'NONE',
    DeleteStatus: 'NONE',
    MarkStatus: 'NONE',
    UrlStatus: 'NONE',
    FileSizeLo: 8,
    FileSizeHi: 0,
    FileSizeMB: 0,
    FileCount: 1,
    MinPostTime: 1793361600,
    MaxPostTime: 1793361600,
    TotalArticles: 1,
    SuccessArticles: 0,
    FailedArticles: 0,
    Health: 1000,
    CriticalHealth: 1000,
    DupeKey: '',
    DupeScore: 0,
    DupeMode: 'SCORE',
    Deleted: false,
    DownloadedSizeLo: 0,
    DownloadedSizeHi: 0,
    DownloadedSizeMB: 0,
    DownloadTimeSec: 0,
    PostTotalTimeSec: 0,
    ParTimeSec: 0,
    RepairTimeSec: 0,
    UnpackTimeSec: 0,
    MessageCount: 2,
    ExtraParBlocks: 0,
    Parameters: [{ Name: '*Unpack:', Value: 'yes' }],
    ScriptStatuses: [],
    ServerStats: [],
  };
}

function queueEntry(id: number, name: string, extra: Json): Json {
  return {
    FirstID: id,
    LastID: id,
    RemainingSizeLo: 8,
    RemainingSizeHi: 0,
    RemainingSizeMB: 0,
    PausedSizeLo: 0,
    PausedSizeHi: 0,
    PausedSizeMB: 0,
    RemainingFileCount: 1,
    RemainingParCount: 0,
    MinPriority: 0,
    MaxPriority: 0,
    ActiveDownloads: 0,
    Status: 'QUEUED',
    ...shared(id, name),
    PostInfoText: 'NONE',
    PostStageProgress: 0,
    PostStageTimeSec: 0,
    Log: [],
    ...extra,
  };
}

function historyEntry(id: number, name: string, extra: Json): Json {
  return { ID: id, Name: name, RemainingFileCount: 0, RetryData: false, HistoryTime: 1795161641, Status: 'SUCCESS/HEALTH', Log: [], ...shared(id, name), ...extra };
}

/** The statuses behind each history `Status`, read backwards from `NzbInfo::MakeTextStatus`. */
const CAUSES: Record<string, Json> = {
  'DELETED/MANUAL': { DeleteStatus: 'MANUAL', Deleted: true },
  'DELETED/DUPE': { DeleteStatus: 'DUPE', Deleted: true },
  'DELETED/COPY': { DeleteStatus: 'COPY', Deleted: true },
  'DELETED/GOOD': { DeleteStatus: 'GOOD', Deleted: true },
  'FAILURE/HEALTH': { DeleteStatus: 'HEALTH', Deleted: true },
  'FAILURE/SCAN': { DeleteStatus: 'SCAN', Deleted: true },
  'FAILURE/BAD': { DeleteStatus: 'BAD', MarkStatus: 'BAD', Deleted: true },
  'FAILURE/PAR': { ParStatus: 'FAILURE' },
  'FAILURE/UNPACK': { UnpackStatus: 'FAILURE' },
  'FAILURE/MOVE': { MoveStatus: 'FAILURE' },
  'WARNING/PASSWORD': { UnpackStatus: 'PASSWORD' },
  'WARNING/SPACE': { UnpackStatus: 'SPACE' },
  'WARNING/DAMAGED': { ParStatus: 'MANUAL' },
  'WARNING/REPAIRABLE': { ParStatus: 'REPAIR_POSSIBLE' },
  'WARNING/SCRIPT': { ScriptStatus: 'FAILURE' },
  'SUCCESS/ALL': { ParStatus: 'SUCCESS', UnpackStatus: 'SUCCESS', MoveStatus: 'SUCCESS', ScriptStatus: 'SUCCESS' },
  'SUCCESS/HEALTH': { MoveStatus: 'SUCCESS' },
};

/** What the stand-in keeps about a job for itself; NZBGet sends no such fields. */
function published(entries: readonly Json[]): Json[] {
  return entries.map(({ Document: _document, Leaving: _leaving, ...entry }) => entry);
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function note(fake: FakeNzbget, kind: string, text: string): void {
  fake.log.push({ ID: fake.log.length + 1, Kind: kind, Time: now(), Text: text });
}

/** NZBGet's reader takes every string in the order it appears, object keys included, and keeps escapes as written. */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [JSON.stringify(value).slice(1, -1)];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([key, inner]) => [key, ...stringsOf(inner)]);
  return [];
}

function toHistory(fake: FakeNzbget, entry: Json, extra: Json): void {
  fake.queue.splice(fake.queue.indexOf(entry), 1);
  if (!fake.keepsHistory) return;
  const { FirstID: _first, LastID: _last, PostInfoText: _text, PostStageProgress: _progress, PostStageTimeSec: _time, ...kept } = entry;
  fake.history.unshift(historyEntry(entry['NZBID'] as number, entry['NZBName'] as string, { ...kept, HistoryTime: now(), ...extra }));
}

function append(fake: FakeNzbget, params: readonly unknown[], nextId: () => number): number {
  const [fileName, content, category, priority, , addPaused, , , , ...rest] = params as [string, string, string, number, boolean, boolean, string, number, string, ...unknown[]];
  if (!fake.canStore) return -1;
  const id = nextId();
  const name = (fileName.split(/[\\/]/).pop() as string).replace(/\.nzb$/i, '');
  const document = Buffer.from(content, 'base64').toString('utf8');
  const strings = stringsOf(rest);
  const parameters = [];
  for (let at = 0; at + 1 < strings.length; at += 2) parameters.push({ Name: strings[at], Value: strings[at + 1] });
  const base = { NZBFilename: fileName, Category: category, Parameters: [...parameters, { Name: '*Unpack:', Value: 'yes' }], Document: document };
  if (!document.includes('<nzb')) {
    fake.history.unshift(historyEntry(id, name, { ...base, Status: 'FAILURE/SCAN', DeleteStatus: 'SCAN', Deleted: true, FileSizeLo: 0, FileCount: 0 }));
  } else if ([...fake.queue, ...fake.history].some((job) => job['Document'] === document)) {
    fake.history.unshift(historyEntry(id, name, { ...base, Status: 'DELETED/COPY', DeleteStatus: 'COPY', Deleted: true }));
  } else {
    const held = addPaused ? { Status: 'PAUSED', PausedSizeLo: 8 } : {};
    fake.queue.push(queueEntry(id, name, { ...base, MinPriority: priority, MaxPriority: priority, ...held }));
  }
  return id;
}

function takeBack(fake: FakeNzbget, entry: Json): void {
  fake.history.splice(fake.history.indexOf(entry), 1);
  const { ID: _id, Name: _name, RetryData: _retry, HistoryTime: _time, ...kept } = entry;
  const returned = queueEntry(entry['NZBID'] as number, entry['NZBName'] as string, { ...kept, Status: 'QUEUED', DeleteStatus: 'NONE', Deleted: false, MessageCount: (entry['MessageCount'] as number) + 1 });
  fake.queue.unshift(returned);
  if (fake.failsAtOnce) toHistory(fake, returned, { Status: 'FAILURE/HEALTH', DeleteStatus: 'HEALTH', HistoryTime: (entry['HistoryTime'] as number) + 1 });
}

function removeFromHistory(fake: FakeNzbget, entry: Json): void {
  const id = entry['NZBID'] as number;
  note(fake, 'INFO', `Deleting ${String(entry['Name'])} from history`);
  const deletes = entry['DeleteStatus'] !== 'NONE' || entry['ParStatus'] === 'FAILURE' || entry['UnpackStatus'] === 'FAILURE' || entry['UnpackStatus'] === 'PASSWORD';
  if (deletes && fake.directories.has(id)) {
    note(fake, 'INFO', `Deleting ${String(entry['DestDir'])}`);
    if (fake.stuck.has(id)) note(fake, 'ERROR', `Could not delete directory ${String(entry['DestDir'])}: Permission denied (code 13)`);
    else fake.directories.delete(id);
  }
  fake.history.splice(fake.history.indexOf(entry), 1);
  note(fake, 'INFO', `Collection ${String(entry['Name'])} removed from history`);
}

const QUEUE_EDITS: Record<string, (fake: FakeNzbget, entry: Json) => void> = {
  GroupPause: (_fake, entry) => Object.assign(entry, { Status: 'PAUSED', PausedSizeLo: entry['RemainingSizeLo'], PausedSizeHi: entry['RemainingSizeHi'] }),
  GroupResume: (_fake, entry) => Object.assign(entry, { Status: 'QUEUED', PausedSizeLo: 0, PausedSizeHi: 0 }),
  GroupParkDelete: (fake, entry) => {
    // A job that has left the download phase has no files left to park, and NZBGet does nothing to it.
    if (!['QUEUED', 'PAUSED', 'DOWNLOADING'].includes(entry['Status'] as string)) return;
    if (fake.lingers > 0) entry['Leaving'] = fake.lingers;
    else toHistory(fake, entry, { Status: 'DELETED/MANUAL', DeleteStatus: 'MANUAL', Deleted: true });
  },
};

const HISTORY_EDITS: Record<string, (fake: FakeNzbget, entry: Json) => void> = {
  HistoryDelete: removeFromHistory,
  HistoryRetryFailed: (fake, entry) => {
    if (fake.directories.has(entry['NZBID'] as number)) takeBack(fake, entry);
    else note(fake, 'ERROR', `Could not retry failed articles for ${String(entry['Name'])}: destination directory ${String(entry['DestDir'])} doesn't exist`);
  },
  HistoryRedownload: (fake, entry) => {
    if (entry['Document'] === undefined) note(fake, 'ERROR', `Could not download again ${String(entry['Name'])}: could not find source nzb-file`);
    else takeBack(fake, entry);
  },
};

function editQueue(fake: FakeNzbget, params: readonly unknown[]): boolean | Json {
  const [command, , ids] = params as [string, string, number[]];
  const inQueue = QUEUE_EDITS[command];
  const inHistory = HISTORY_EDITS[command];
  const known = inQueue !== undefined || inHistory !== undefined;
  if (!known || (!fake.parks && ['GroupParkDelete', 'HistoryRetryFailed'].includes(command))) return { name: 'JSONRPCError', code: 3, message: 'Invalid action' };
  const entry = (inQueue ? fake.queue : fake.history).find((job) => ids.includes(job['NZBID'] as number));
  if (entry === undefined) return false;
  if (!fake.inert.has(command)) (inQueue ?? inHistory)?.(fake, entry);
  return true;
}

function listGroups(fake: FakeNzbget): Json[] {
  for (const entry of fake.queue.filter((job) => job['Leaving'] !== undefined)) {
    const leaving = entry['Leaving'] as number;
    if (leaving > 1) entry['Leaving'] = leaving - 1;
    else toHistory(fake, entry, { Status: 'DELETED/MANUAL', DeleteStatus: 'MANUAL', Deleted: true, Leaving: undefined });
  }
  return published(fake.queue);
}

function answer(response: ServerResponse, body: Json): void {
  const text = `${JSON.stringify({ version: '1.1', ...body }, null, 0)}\n`;
  response.writeHead(200, { connection: 'close', 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) }).end(text);
}

function applyFault(fault: NzbgetFault, response: ServerResponse): void {
  if (fault.kind === 'hang-up') response.destroy();
  else if (fault.kind === 'answer') response.writeHead(fault.status ?? 200, { connection: 'close', 'content-type': 'application/json' }).end(fault.body ?? '');
}

function isAuthorised(fake: FakeNzbget, header: string | undefined): boolean {
  if (fake.login === undefined) return true;
  return header === `Basic ${Buffer.from(`${fake.login.username}:${fake.login.password}`).toString('base64')}`;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/**
 * Starts the stand-in on a free loopback port with the four categories a fresh
 * NZBGet has, an empty queue and history, and no login until `login` is set.
 */
export async function startFakeNzbget(): Promise<FakeNzbget> {
  let lastId = 0;
  const nextId = (): number => (lastId += 1);
  const methods: Record<string, (params: readonly unknown[]) => unknown> = {
    version: () => VERSION,
    config: () => fake.settings,
    listgroups: () => listGroups(fake),
    history: () => published(fake.history),
    log: (params) => fake.log.slice(-(params[1] as number)),
    append: (params) => append(fake, params, nextId),
    editqueue: (params) => editQueue(fake, params),
  };
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      if (incoming.url !== '/jsonrpc') return void response.writeHead(404, { connection: 'close' }).end();
      if (!isAuthorised(fake, incoming.headers.authorization)) {
        return void response.writeHead(401, { 'www-authenticate': 'Basic realm="NZBGet"', connection: 'close', 'content-type': 'text/plain', 'content-length': 0 }).end();
      }
      const { method, params } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { method: string; params: unknown[] };
      fake.calls.push({ method, params, headers: incoming.headers });
      const fault = fake.faults.find((entry) => entry.method === method);
      if (fault !== undefined && (fault.skip ?? 0) > 0) fault.skip = (fault.skip ?? 0) - 1;
      else if (fault !== undefined) return applyFault(fake.faults.splice(fake.faults.indexOf(fault), 1)[0] as NzbgetFault, response);
      const run = methods[method];
      if (run === undefined) return answer(response, { error: { name: 'JSONRPCError', code: 1, message: 'Invalid procedure' } });
      const result = run(params);
      const failed = typeof result === 'object' && result !== null && 'code' in result;
      answer(response, failed ? { error: result } : { result });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const fake: FakeNzbget = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    calls: [],
    faults: [],
    queue: [],
    history: [],
    log: [],
    settings: DEFAULT_SETTINGS.map((setting) => ({ ...setting })),
    directories: new Set(),
    stuck: new Set(),
    inert: new Set(),
    login: undefined,
    keepsHistory: true,
    canStore: true,
    parks: true,
    lingers: 0,
    failsAtOnce: false,
    seedQueue(entry) {
      const id = nextId();
      const seeded = queueEntry(id, String(entry['NZBName'] ?? `job ${id}`), { Document: `<nzb seeded="${id}"/>`, ...entry });
      fake.queue.push(seeded);
      return seeded;
    },
    seedHistory(entry) {
      const id = nextId();
      const seeded = historyEntry(id, String(entry['NZBName'] ?? `job ${id}`), { Document: `<nzb seeded="${id}"/>`, ...CAUSES[String(entry['Status'])], ...entry });
      fake.history.unshift(seeded);
      return seeded;
    },
    close: () => closeServer(server),
  };
  return fake;
}
