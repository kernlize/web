import { NZB_ACTIONS, NZB_LIMITS, need, type NzbAddRequest, type NzbControlRequest, type NzbJobsRequest } from './nzb-wire.js';

const MAX_TEXT_LENGTH = 1024;
const MAX_URL_LENGTH = 4096;
const MISSHAPEN = 'The request is not shaped as NAP-NZB describes';
// RFC 4648 section 4 with padding; the last character before `=` may carry no stray bits. Checked in two
// parts because one pattern over a whole document of several megabytes overruns the regular expression stack.
const NOT_BASE64 = /[^A-Za-z0-9+/]/;
const LAST_QUAD = /^(?:[A-Za-z0-9+/]{4}|[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/;
// Absolute https with a host, no userinfo, no fragment and no whitespace.
const HTTPS_URL = /^https:\/\/[^/?#@\s]+(?:[/?][^#\s]*)?$/i;

type Check = (value: unknown) => boolean;
type Loose = Readonly<Record<string, unknown>>;

const text: Check = (value) => typeof value === 'string' && value !== '';
const flag: Check = (value) => typeof value === 'boolean';
const count =
  (least: number): Check =>
  (value) =>
    Number.isSafeInteger(value) && (value as number) >= least;
const oneOf =
  (choices: readonly string[]): Check =>
  (value) =>
    choices.includes(value as string);
const base64: Check = (value) => typeof value === 'string' && value.length % 4 === 0 && !NOT_BASE64.test(value.slice(0, -4)) && LAST_QUAD.test(value.slice(-4));
const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);

function shaped(value: unknown, required: Readonly<Record<string, Check>>, optional: Readonly<Record<string, Check>> = {}): boolean {
  if (!isObject(value)) return false;
  const checks = new Map([...Object.entries(required), ...Object.entries(optional)]);
  return Object.keys(required).every((field) => Object.hasOwn(value, field)) && Object.entries(value).every(([field, held]) => checks.get(field)?.(held) === true);
}

function read<T>(value: unknown, required: Readonly<Record<string, Check>>, optional?: Readonly<Record<string, Check>>): T {
  need(shaped(value, required, optional), 'invalid_request', MISSHAPEN);
  need(Object.values(value as Loose).every((held) => typeof held !== 'string' || held.length <= MAX_TEXT_LENGTH), 'limit_exceeded', 'A text value is longer than the shell accepts');
  return value as T;
}

const source: Check = (value) =>
  shaped(value, { kind: (kind) => kind === 'bytes', dataBase64: base64 }) ||
  shaped(value, { kind: (kind) => kind === 'url', url: (url) => text(url) && (url as string).length <= MAX_URL_LENGTH && HTTPS_URL.test(url as string) && URL.canParse(url as string) });

const page = { after: text, limit: count(1) };

/** How each NAP-NZB request type carries its parameters beside `type` and `id`. */
const ENVELOPES: Readonly<Record<string, Readonly<Record<string, Check>>>> = {
  'nzb.downloaders': {},
  'nzb.add': { request: isObject },
  'nzb.jobs': { request: isObject },
  'nzb.status': { jobId: text },
  'nzb.control': { request: isObject },
  'nzb.files': { request: isObject },
  'nzb.read': { request: isObject },
};

/**
 * Every inbound NAP-NZB message type.
 *
 * @example
 * ```ts
 * NZB_REQUEST_TYPES.includes('nzb.add'); // true
 * ```
 */
export const NZB_REQUEST_TYPES: readonly string[] = Object.keys(ENVELOPES);

/**
 * Checks a message's envelope and takes out what it carries: nothing for
 * `nzb.downloaders`, `jobId` for `nzb.status`, `request` for the rest. A field the
 * type does not have is `invalid_request` (NAP-NZB, Common values).
 *
 * @param message - The message as received, of a type in {@link NZB_REQUEST_TYPES}.
 * @returns The payload, still unchecked beyond being an object or nonempty text.
 * @example
 * ```ts
 * readNzbEnvelope({ type: 'nzb.status', id: 's1', jobId: 'job-a' }); // 'job-a'
 * ```
 */
export function readNzbEnvelope(message: { readonly type: string }): unknown {
  const fields = message as Loose;
  need(shaped(fields, { type: text, id: text, ...ENVELOPES[message.type] }), 'invalid_request', MISSHAPEN);
  return fields.request ?? fields.jobId;
}

/**
 * Checks an `AddRequest`: every field known and of its type, base64 canonical, an
 * address absolute `https` with no userinfo and no fragment.
 *
 * @param request - The request as received.
 * @returns The same object, typed.
 * @example
 * ```ts
 * readNzbAdd({ downloaderId, operationKey: 'add-1', source: { kind: 'bytes', dataBase64 } });
 * ```
 */
export function readNzbAdd(request: unknown): NzbAddRequest {
  return read(request, { downloaderId: text, operationKey: text, source }, { name: text, categoryId: text, priority: oneOf(['low', 'normal', 'high']), startPaused: flag, password: text });
}

/**
 * Checks a `JobsRequest` and settles its page size.
 *
 * @param request - The request as received.
 * @returns The request with `limit` filled in; a limit above the advertised page size is `limit_exceeded`.
 * @example
 * ```ts
 * readNzbJobs({ downloaderId }).limit; // 100
 * ```
 */
export function readNzbJobs(request: unknown): Required<Pick<NzbJobsRequest, 'downloaderId' | 'limit'>> & Pick<NzbJobsRequest, 'after'> {
  const jobs = read<NzbJobsRequest>(request, { downloaderId: text }, page);
  const limit = jobs.limit ?? NZB_LIMITS.maxPageSize;
  need(limit <= NZB_LIMITS.maxPageSize, 'limit_exceeded', 'That is more jobs than the shell lists at a time');
  return { ...jobs, limit };
}

/**
 * Checks a `ControlRequest`.
 *
 * @param request - The request as received.
 * @returns The same object, typed.
 * @example
 * ```ts
 * readNzbControl({ jobId, operationKey: 'pause-1', action: 'pause' });
 * ```
 */
export function readNzbControl(request: unknown): NzbControlRequest {
  return read(request, { jobId: text, operationKey: text, action: oneOf(NZB_ACTIONS) });
}

/**
 * Checks a `FilesRequest` or, with `reading`, a `ReadRequest`. kernl cannot read a
 * downloader's files, so only the job named matters afterwards.
 *
 * @param request - The request as received.
 * @param reading - Whether this is `nzb.read`.
 * @returns The job handle the request names.
 * @example
 * ```ts
 * readNzbFiles({ jobId: 'job-a' }, false); // 'job-a'
 * ```
 */
export function readNzbFiles(request: unknown, reading: boolean): string {
  const checked = reading ? read<{ jobId: string }>(request, { jobId: text, fileId: text, offset: count(0), length: count(1) }) : read<{ jobId: string }>(request, { jobId: text }, page);
  return checked.jobId;
}

/**
 * Decodes canonical base64 that {@link readNzbAdd} already checked.
 *
 * @param data - Standard padded base64.
 * @returns The decoded bytes.
 * @example
 * ```ts
 * decodeNzbBase64('PG56Yi8+'); // the bytes of '<nzb/>'
 * ```
 */
export function decodeNzbBase64(data: string): Uint8Array {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
}
