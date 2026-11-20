import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for SABnzbd 5.1.3 that speaks its `/api` interface over a real socket.
 *
 * Answers, field names and wording were copied from a real SABnzbd 5.1.3 container:
 * the 403 with "API Key Incorrect" or "API Key Required", `addfile` answering with the
 * new id or with `status: false` and no ids for a document it cannot read, a job name
 * holding `{{…}}` being read as a password, an unknown category falling back to `*`,
 * queue slots reading "Downloading" for every job that is not held even while nothing
 * transfers, pause, resume and history removal answering `true` for ids that do not
 * exist, a changed priority releasing a held job, a queue removal leaving no record,
 * `retry` making a job with a new id, and the history slots of completed and failed
 * jobs. Post-processing statuses were not seen there; those follow `add_active_history`
 * in SABnzbd's source. The 200 answers to a wrong key are how versions before 5 replied.
 */

type Json = Record<string, unknown>;

/** A way for one kind of request to go wrong that SABnzbd's own logic would not produce on demand. */
export interface SabnzbdFault {
  /** `mode`, or `mode.name` for the queue and history operations. */
  readonly request: string;
  readonly kind: 'answer' | 'hang-up' | 'silence';
  /** How many such requests go through untouched first. */
  skip?: number;
  readonly status?: number;
  readonly body?: string;
}

export interface SabnzbdRequest {
  /** `mode`, or `mode.name`. */
  readonly request: string;
  readonly method: string;
  /** What followed `?` in the address. */
  readonly query: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly upload?: { readonly fileName: string; readonly text: string };
}

export interface FakeSabnzbd {
  readonly url: string;
  readonly requests: SabnzbdRequest[];
  readonly faults: SabnzbdFault[];
  readonly queue: Json[];
  readonly history: Json[];
  readonly categories: string[];
  /** Jobs whose folder of partial files exists on its disk, by id. */
  readonly folders: Set<string>;
  /** Queue and history operations (`queue.pause`, `history.delete`…) it answers `true` to without doing anything. */
  readonly inert: Set<string>;
  apiKey: string | undefined;
  /** How a wrong or missing key is answered: 403 since 5.0, 200 with plain text or JSON before. */
  keyRefusal: 'forbidden' | 'plain' | 'json';
  /** The whole downloader's pause, which is not any job's hold. */
  paused: boolean;
  /** Whether articles are arriving right now. */
  transferring: boolean;
  /** Old versions answer a retry with `true` and no id. */
  namesSuccessor: boolean;
  seedQueue(entry: Json): Json;
  seedHistory(entry: Json): Json;
  close(): Promise<void>;
}

const VERSION = '5.1.3';
const PRIORITY_NAMES: Record<string, string> = { '-1': 'Low', '0': 'Normal', '1': 'High', '2': 'Force' };

function queueSlot(name: string, extra: Json): Json {
  return {
    index: 0,
    nzo_id: randomUUID(),
    unpackopts: '3',
    priority: 'Normal',
    script: 'None',
    filename: name,
    labels: [],
    password: '',
    cat: '*',
    mbleft: '0.00',
    mb: '0.00',
    size: '8 B',
    sizeleft: '8 B',
    percentage: '0',
    mbmissing: '0.00',
    direct_unpack: null,
    status: 'Queued',
    timeleft: '0:00:00',
    avg_age: '20d',
    time_added: 1795161531,
    ...extra,
  };
}

function historySlot(name: string, extra: Json): Json {
  const id = randomUUID();
  return {
    completed: 1795161674,
    name,
    nzb_name: `${name}.nzb`,
    category: '*',
    pp: 'D',
    script: 'None',
    report: '',
    url: null,
    status: 'Completed',
    nzo_id: id,
    storage: `/config/Downloads/complete/${name}`,
    path: `/config/Downloads/incomplete/${name}`,
    script_line: '',
    download_time: 0,
    postproc_time: 0,
    stage_log: [{ name: 'Source', actions: [`${name}.nzb`] }],
    downloaded: 8,
    completeness: null,
    fail_message: '',
    url_info: '',
    bytes: 8,
    meta: null,
    series: null,
    md5sum: 'fbcea4db0c5bba76da11e66fe0615bdd',
    password: null,
    duplicate_key: null,
    archive: false,
    time_added: 1795161674,
    size: '8 B',
    action_line: '',
    loaded: false,
    retry: false,
    ...extra,
  };
}

function ids(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

function queueListing(fake: FakeSabnzbd, fields: Readonly<Record<string, string>>): Json {
  const wanted = ids(fields['nzo_ids']);
  const limit = Number(fields['limit'] ?? 0);
  const matched = fake.queue.filter((slot) => wanted.length === 0 || wanted.includes(slot['nzo_id'] as string));
  const slots = matched.slice(0, limit || undefined).map((slot, index) => {
    const status = slot['status'] as string;
    // SABnzbd calls every job it is free to fetch "Downloading", first in line or not.
    return { ...slot, index, status: !fake.paused && status === 'Queued' ? 'Downloading' : status };
  });
  const status = fake.paused ? 'Paused' : fake.transferring ? 'Downloading' : 'Idle';
  return { queue: { version: VERSION, paused: fake.paused, pause_int: '0', paused_all: false, speedlimit: '0', kbpersec: fake.transferring ? '512.00' : '0.00', speed: fake.transferring ? '512 K' : '0', noofslots_total: fake.queue.length, noofslots: matched.length, start: 0, limit, finish: limit, status, timeleft: '0:00:00', slots } };
}

function historyListing(fake: FakeSabnzbd, fields: Readonly<Record<string, string>>): Json {
  const wanted = ids(fields['nzo_ids']);
  const start = Number(fields['start'] ?? 0);
  // Without a limit SABnzbd shows as many as its `history_limit` setting says, ten on a fresh install.
  const limit = Number(fields['limit'] ?? 0) || 10;
  const matched = fake.history.filter((slot) => wanted.length === 0 || wanted.includes(slot['nzo_id'] as string));
  return { history: { total_size: '247', month_size: '247', week_size: '247', day_size: '247', slots: matched.slice(start, start + limit), ppslots: 0, noofslots: matched.length, last_history_update: 1, version: VERSION } };
}

function addFile(fake: FakeSabnzbd, request: SabnzbdRequest): Json {
  const { fields, upload } = request;
  if (upload === undefined) return { status: false, error: 'expects one parameter' };
  if (!upload.text.includes('<nzb')) return { status: false, nzo_ids: [] };
  const [, name = '', password = ''] = /^(.*?)\s*(?:\{\{(.*)\}\})?$/.exec(fields['nzbname'] || upload.fileName.replace(/\.nzb$/i, '')) as RegExpExecArray;
  const held = fields['priority'] === '-2';
  const slot = queueSlot(name, {
    password: fields['password'] ?? password,
    cat: fake.categories.includes(fields['cat'] ?? '') ? fields['cat'] : '*',
    priority: PRIORITY_NAMES[fields['priority'] ?? ''] ?? 'Normal',
    status: held ? 'Paused' : 'Queued',
  });
  fake.queue.push(slot);
  return { status: true, nzo_ids: [slot['nzo_id']] };
}

function retry(fake: FakeSabnzbd, fields: Readonly<Record<string, string>>): Json {
  const failed = fake.history.find((slot) => slot['nzo_id'] === fields['value'] && slot['status'] === 'Failed');
  if (failed === undefined || !fake.folders.has(failed['nzo_id'] as string)) return { status: false, error: 'item does not exist' };
  fake.history.splice(fake.history.indexOf(failed), 1);
  fake.folders.delete(failed['nzo_id'] as string);
  const slot = queueSlot(failed['name'] as string, { cat: failed['category'] });
  fake.folders.add(slot['nzo_id'] as string);
  fake.queue.push(slot);
  return fake.namesSuccessor ? { status: true, nzo_id: slot['nzo_id'] } : { status: true };
}

function setHold(fake: FakeSabnzbd, fields: Readonly<Record<string, string>>, status: string): Json {
  const handled = ids(fields['value']);
  for (const slot of fake.queue) if (handled.includes(slot['nzo_id'] as string)) slot['status'] = status;
  // SABnzbd echoes the ids it was given, found or not.
  return { status: handled.length > 0, nzo_ids: handled };
}

function removeFromQueue(fake: FakeSabnzbd, fields: Readonly<Record<string, string>>): Json {
  const wanted = ids(fields['value']);
  const removed = fake.queue.filter((slot) => fields['value'] === 'all' || wanted.includes(slot['nzo_id'] as string));
  for (const slot of removed) {
    fake.queue.splice(fake.queue.indexOf(slot), 1);
    if (fields['del_files'] === '1') fake.folders.delete(slot['nzo_id'] as string);
  }
  return { status: removed.length > 0, nzo_ids: removed.map((slot) => slot['nzo_id']) };
}

function setPriority(fake: FakeSabnzbd, fields: Readonly<Record<string, string>>): Json {
  const slot = fake.queue.find((entry) => entry['nzo_id'] === fields['value']);
  // Seen on the real program: a new priority also clears the job's hold.
  if (slot !== undefined) Object.assign(slot, { priority: PRIORITY_NAMES[fields['value2'] ?? ''] ?? 'Normal', status: 'Queued' });
  return { position: slot === undefined ? -1 : fake.queue.indexOf(slot) };
}

function removeFromHistory(fake: FakeSabnzbd, fields: Readonly<Record<string, string>>): Json {
  const value = (fields['value'] ?? '').toLowerCase();
  const statuses: Record<string, string[]> = { all: ['Failed', 'Completed'], failed: ['Failed'], completed: ['Completed'] };
  const wanted = ids(fields['value']);
  const removed = fake.history.filter((slot) => (statuses[value] ?? []).includes(slot['status'] as string) || wanted.includes(slot['nzo_id'] as string));
  for (const slot of removed) {
    fake.history.splice(fake.history.indexOf(slot), 1);
    if (fields['del_files'] === '1' && slot['status'] === 'Failed') fake.folders.delete(slot['nzo_id'] as string);
  }
  return { status: true };
}

const OPERATIONS: Record<string, (fake: FakeSabnzbd, request: SabnzbdRequest) => Json> = {
  version: () => ({ version: VERSION }),
  get_cats: (fake) => ({ categories: ['*', ...fake.categories] }),
  queue: (fake, request) => queueListing(fake, request.fields),
  history: (fake, request) => historyListing(fake, request.fields),
  addfile: addFile,
  retry: (fake, request) => retry(fake, request.fields),
  'queue.pause': (fake, request) => setHold(fake, request.fields, 'Paused'),
  'queue.resume': (fake, request) => setHold(fake, request.fields, 'Queued'),
  'queue.delete': (fake, request) => removeFromQueue(fake, request.fields),
  'queue.priority': (fake, request) => setPriority(fake, request.fields),
  'history.delete': (fake, request) => removeFromHistory(fake, request.fields),
};

function sendJson(response: ServerResponse, body: Json): void {
  response.writeHead(200, { 'content-type': 'application/json;charset=UTF-8' }).end(`${JSON.stringify(body)}\n`);
}

function refuseKey(fake: FakeSabnzbd, response: ServerResponse, words: string): void {
  if (fake.keyRefusal === 'json') sendJson(response, { status: false, error: words });
  else response.writeHead(fake.keyRefusal === 'forbidden' ? 403 : 200, { 'content-type': 'text/html;charset=utf-8' }).end(`${words}\n`);
}

function applyFault(fault: SabnzbdFault, response: ServerResponse): void {
  if (fault.kind === 'hang-up') response.destroy();
  else if (fault.kind === 'answer') response.writeHead(fault.status ?? 200, { 'content-type': 'application/json;charset=UTF-8' }).end(fault.body ?? '');
}

async function readRequest(incoming: IncomingMessage): Promise<SabnzbdRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const query = (incoming.url ?? '').split('?')[1] ?? '';
  const fields: Record<string, string> = Object.fromEntries(new URLSearchParams(query));
  let upload: SabnzbdRequest['upload'];
  if (incoming.method === 'POST') {
    const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': incoming.headers['content-type'] ?? '' } }).formData();
    for (const [name, value] of form) {
      if (typeof value === 'string') fields[name] = value;
      else if (name === 'name' || name === 'nzbfile') upload = { fileName: value.name, text: await value.text() };
    }
  }
  const mode = fields['mode'] ?? '';
  const named = (mode === 'queue' || mode === 'history') && fields['name'] !== undefined;
  return { request: named ? `${mode}.${fields['name']}` : mode, method: incoming.method ?? 'GET', query, fields, ...(upload === undefined ? {} : { upload }) };
}

function route(fake: FakeSabnzbd, request: SabnzbdRequest, response: ServerResponse): void {
  if (request.request !== 'version' && fake.apiKey !== undefined && request.fields['apikey'] !== fake.apiKey) {
    return refuseKey(fake, response, request.fields['apikey'] === undefined ? 'API Key Required' : 'API Key Incorrect');
  }
  const fault = fake.faults.find((entry) => entry.request === request.request);
  if (fault !== undefined && (fault.skip ?? 0) > 0) fault.skip = (fault.skip ?? 0) - 1;
  else if (fault !== undefined) return applyFault(fake.faults.splice(fake.faults.indexOf(fault), 1)[0] as SabnzbdFault, response);
  const operation = OPERATIONS[request.request];
  if (operation === undefined) return sendJson(response, { status: false, error: 'not implemented' });
  if (fake.inert.has(request.request)) return sendJson(response, { status: true, nzo_ids: ids(request.fields['value']) });
  sendJson(response, operation(fake, request));
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/**
 * Starts the stand-in on a free loopback port with the four categories a fresh
 * SABnzbd has, an empty queue and history, nothing transferring, and no key until
 * `apiKey` is set.
 */
export async function startFakeSabnzbd(): Promise<FakeSabnzbd> {
  const server = createServer((incoming, response) => {
    if (!(incoming.url ?? '').startsWith('/api')) return void response.writeHead(404, { 'content-type': 'text/html' }).end('<html>404 Not Found</html>');
    void readRequest(incoming).then((request) => {
      fake.requests.push(request);
      route(fake, request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const fake: FakeSabnzbd = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests: [],
    faults: [],
    queue: [],
    history: [],
    categories: ['movies', 'tv', 'audio', 'software'],
    folders: new Set(),
    inert: new Set(),
    apiKey: undefined,
    keyRefusal: 'forbidden',
    paused: false,
    transferring: false,
    namesSuccessor: true,
    seedQueue(entry) {
      const slot = queueSlot(String(entry['filename'] ?? 'job'), entry);
      fake.queue.push(slot);
      return slot;
    },
    seedHistory(entry) {
      const slot = historySlot(String(entry['name'] ?? 'job'), entry);
      fake.history.unshift(slot);
      return slot;
    },
    close: () => closeServer(server),
  };
  return fake;
}
