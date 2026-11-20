import type { ClientEndpoint, ClientFailure, ClientOptions } from './types';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Builds the `Error` every adapter rejects with: the contract's reason first, then an
 * optional detail. The detail is shown to people, so it must never hold a password,
 * key, token or address.
 *
 * @param reason - The stable reason the message starts with.
 * @param detail - A few words saying what went wrong.
 * @returns The error to throw.
 * @example
 * ```ts
 * throw clientError('unavailable:bad-response', 'the answer was not JSON');
 * ```
 */
export function clientError(reason: ClientFailure, detail?: string): Error {
  return new Error(detail === undefined ? reason : `${reason}: ${detail}`);
}

/**
 * The `Authorization` header value for HTTP Basic authentication, with the name and
 * password encoded as UTF-8 as RFC 7617 asks.
 *
 * @param endpoint - Where the name and password come from; either may be absent.
 * @returns `Basic …`, or undefined when the endpoint has neither a name nor a password.
 * @example
 * ```ts
 * basicAuthorization({ url: 'http://127.0.0.1:9091', username: 'me', password: 'secret' }); // 'Basic bWU6c2VjcmV0'
 * ```
 */
export function basicAuthorization(endpoint: ClientEndpoint): string | undefined {
  if (endpoint.username === undefined && endpoint.password === undefined) return undefined;
  const bytes = new TextEncoder().encode(`${endpoint.username ?? ''}:${endpoint.password ?? ''}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/** `Object()` lets a rejection that is not an object (a custom `fetch` may reject with anything) be asked for its name. */
function isTimeout(error: unknown): boolean {
  return (Object(error) as { name?: unknown }).name === 'TimeoutError';
}

/**
 * Sends one request to a client program with the adapter's `fetch` and time limit, and
 * turns the failures every program shares into the contract's reasons. Any other
 * status, 4xx and 5xx included, is returned for the adapter to interpret.
 *
 * The time limit covers reading the body too: a body that stalls rejects with a
 * `TimeoutError`, which {@link readClientJson} and {@link readClientText} map.
 *
 * @param options - The adapter's options; `fetch` and `timeoutMs` are honoured.
 * @param url - The absolute address to request.
 * @param init - Method, headers and body; a `signal` here is replaced by the time limit.
 * @returns The program's answer.
 * @throws `unavailable:unreachable` when no answer came, `unavailable:timeout` when none
 * came in time, `denied:credentials` on 401 or 403.
 * @example
 * ```ts
 * const response = await requestClient(options, `${options.endpoint.url}/api/version`, { headers: { accept: 'application/json' } });
 * ```
 */
export async function requestClient(options: ClientOptions, url: string, init: RequestInit = {}): Promise<Response> {
  const send = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await send(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
  } catch (error) {
    throw isTimeout(error) ? clientError('unavailable:timeout') : clientError('unavailable:unreachable');
  }
  if (response.status === 401 || response.status === 403) throw clientError('denied:credentials');
  return response;
}

/**
 * Reads an answer's body as text.
 *
 * @param response - An answer from {@link requestClient}.
 * @returns The body.
 * @throws `unavailable:timeout` when the body stalls past the time limit,
 * `unavailable:bad-response` when it breaks off.
 * @example
 * ```ts
 * const html = await readClientText(await requestClient(options, url));
 * ```
 */
export async function readClientText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw isTimeout(error) ? clientError('unavailable:timeout') : clientError('unavailable:bad-response', 'the answer broke off');
  }
}

/**
 * Reads an answer's body as JSON.
 *
 * @param response - An answer from {@link requestClient}.
 * @returns The parsed value, unchecked.
 * @throws `unavailable:timeout` when the body stalls past the time limit,
 * `unavailable:bad-response` when it is not JSON.
 * @example
 * ```ts
 * const body = await readClientJson(await requestClient(options, url));
 * ```
 */
export async function readClientJson(response: Response): Promise<unknown> {
  const text = await readClientText(response);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw clientError('unavailable:bad-response', 'the answer was not JSON');
  }
}

/**
 * Re-labels a failure that struck after a change was sent. A request that timed out may
 * still have been carried out, so the caller is told the outcome is unknown instead of
 * being left to assume nothing happened; every other failure passes through unchanged.
 *
 * @param error - What a changing request rejected with.
 * @returns The error to throw in its place.
 * @example
 * ```ts
 * const response = await requestClient(options, url, { method: 'POST', body }).catch((error: unknown) => {
 *   throw afterSending(error);
 * });
 * ```
 */
export function afterSending(error: unknown): unknown {
  return String(Object(error).message).startsWith('unavailable:timeout') ? clientError('unavailable:outcome-unknown', 'the request timed out after it was sent') : error;
}

function unreadable(): Error {
  return clientError('unavailable:bad-response', 'the answer did not have the expected shape');
}

/**
 * Narrows a parsed JSON value to an object.
 *
 * @param value - Any parsed JSON value.
 * @returns The same value, as a record of unknowns.
 * @throws `unavailable:bad-response` when it is not an object.
 * @example
 * ```ts
 * const body = jsonRecord(await readClientJson(response));
 * ```
 */
export function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw unreadable();
  return value as Record<string, unknown>;
}

/**
 * Narrows a parsed JSON value to an array.
 *
 * @param value - Any parsed JSON value.
 * @returns The same value, as a list of unknowns.
 * @throws `unavailable:bad-response` when it is not an array.
 * @example
 * ```ts
 * const rows = jsonList(body.torrents);
 * ```
 */
export function jsonList(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw unreadable();
  return value as readonly unknown[];
}

/**
 * Narrows a parsed JSON value to a finite number.
 *
 * @param value - Any parsed JSON value.
 * @returns The same value.
 * @throws `unavailable:bad-response` when it is not a finite number.
 * @example
 * ```ts
 * const size = jsonNumber(row.totalSize);
 * ```
 */
export function jsonNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw unreadable();
  return value;
}

/**
 * Narrows a parsed JSON value to a string.
 *
 * @param value - Any parsed JSON value.
 * @returns The same value.
 * @throws `unavailable:bad-response` when it is not a string.
 * @example
 * ```ts
 * const name = jsonText(row.name);
 * ```
 */
export function jsonText(value: unknown): string {
  if (typeof value !== 'string') throw unreadable();
  return value;
}
