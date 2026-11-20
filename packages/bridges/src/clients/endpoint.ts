/** How the page that runs kernl was itself loaded. */
export type PageScheme = 'http' | 'https';

/**
 * Something the person should know about an address that is still usable:
 *
 * - `cleartext` http to another machine: name, password and everything sent can be read on the way.
 * - `cleartext-loopback` http to this device: nothing leaves the machine.
 * - `page-insecure` kernl itself was loaded over http: the address is https, but what is typed is not protected by kernl's own page.
 */
export type EndpointNote = 'cleartext' | 'cleartext-loopback' | 'page-insecure';

/** The verdict on one typed address. */
export type EndpointCheck =
  | { readonly ok: true; readonly url: string; readonly scheme: PageScheme; readonly loopback: boolean; readonly notes: readonly EndpointNote[] }
  | { readonly ok: false; readonly reason: 'invalid:address' | 'invalid:scheme' | 'invalid:credentials-in-address' | 'invalid:mixed-content' };

type Allowed = Extract<EndpointCheck, { ok: true }>;
type Refused = Extract<EndpointCheck, { ok: false }>;

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
/** The URL parser has already turned every spelling of an IPv4 address (`127.1`, `0x7f.0.0.1`, `2130706433`) into four decimal parts. */
const IPV4_LOOPBACK = /^127\.\d+\.\d+\.\d+$/;
const SCHEMES: readonly PageScheme[] = ['https', 'http'];

function refused(reason: Refused['reason']): Refused {
  return { ok: false, reason };
}

/**
 * The hosts a browser treats as this device when it decides about mixed content
 * (Secure Contexts, "potentially trustworthy origin"): `localhost` and names under it,
 * with or without the root dot, 127.0.0.0/8 and `::1`. An IPv4-mapped IPv6 loopback is
 * not on that list, so it is not here either.
 */
function isLoopback(hostname: string): boolean {
  const host = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  return host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || IPV4_LOOPBACK.test(host);
}

function parse(address: string): URL | undefined {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
}

function notesFor(scheme: PageScheme, loopback: boolean, page: PageScheme): readonly EndpointNote[] {
  if (scheme === 'https') return page === 'https' ? [] : ['page-insecure'];
  return [loopback ? 'cleartext-loopback' : 'cleartext'];
}

/**
 * Checks a complete address (with scheme) against how kernl is served. A page loaded
 * over https may not call a plain http address unless that address is this device,
 * so that combination is refused before anything is saved or sent.
 *
 * @param address - What the person typed, scheme included.
 * @param page - How kernl's own page was loaded.
 * @returns The normalised address with what the person should know about it, or why it cannot be used.
 * @example
 * ```ts
 * checkClientEndpoint('HTTP://LocalHost:8080/sabnzbd/', 'https');
 * // { ok: true, url: 'http://localhost:8080/sabnzbd', scheme: 'http', loopback: true, notes: ['cleartext-loopback'] }
 * checkClientEndpoint('http://nas.local:9091', 'https'); // { ok: false, reason: 'invalid:mixed-content' }
 * ```
 */
export function checkClientEndpoint(address: string, page: PageScheme): EndpointCheck {
  const url = parse(address.trim());
  if (url === undefined) return refused('invalid:address');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return refused('invalid:scheme');
  if (url.username !== '' || url.password !== '') return refused('invalid:credentials-in-address');
  if (/[?#]/.test(url.href)) return refused('invalid:address');
  const scheme: PageScheme = url.protocol === 'https:' ? 'https' : 'http';
  const loopback = isLoopback(url.hostname);
  if (page === 'https' && scheme === 'http' && !loopback) return refused('invalid:mixed-content');
  return { ok: true, url: `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`, scheme, loopback, notes: notesFor(scheme, loopback, page) };
}

/**
 * The addresses to try, in order, for what the person typed. With a scheme it is that
 * one address. Without one (`nas.local:9091`, `localhost:8080/sabnzbd`) the scheme has
 * to be detected: https first, then http, leaving out any the page may not call.
 *
 * The list is never empty: when nothing may be tried it holds the single refusal to
 * show the person.
 *
 * @param typed - What the person typed, with or without a scheme.
 * @param page - How kernl's own page was loaded.
 * @returns The usable addresses in the order to try them, or one refusal.
 * @example
 * ```ts
 * endpointCandidates('nas.local:9091', 'http').map((check) => check.ok && check.url);
 * // ['https://nas.local:9091', 'http://nas.local:9091']
 * endpointCandidates('nas.local:9091', 'https').map((check) => check.ok && check.url);
 * // ['https://nas.local:9091']
 * ```
 */
export function endpointCandidates(typed: string, page: PageScheme): readonly EndpointCheck[] {
  const text = typed.trim();
  if (HAS_SCHEME.test(text)) return [checkClientEndpoint(text, page)];
  const checks = SCHEMES.map((scheme) => checkClientEndpoint(`${scheme}://${text}`, page));
  const allowed = checks.filter((check): check is Allowed => check.ok);
  return allowed.length > 0 ? allowed : checks.slice(0, 1);
}

/**
 * Finds where a program answers: tries each allowed candidate with `probe` and settles
 * on the first that answers.
 *
 * A probe that fails `denied:credentials` ends the search at once. The program answered
 * there, and trying the next scheme would send the name and password somewhere else.
 *
 * @param typed - What the person typed, with or without a scheme.
 * @param page - How kernl's own page was loaded.
 * @param probe - Asks the program at one address whether it is there; rejects when it is not.
 * @returns The address that answered and what the probe resolved with.
 * @throws An `Error` starting `invalid:` when no candidate may be tried; otherwise whatever the last probe rejected with.
 * @example
 * ```ts
 * const { endpoint, result } = await detectClientEndpoint('localhost:5030', 'https', (url) =>
 *   createSlskdClient({ endpoint: { url, apiKey } }).probe(),
 * );
 * ```
 */
export async function detectClientEndpoint<T>(
  typed: string,
  page: PageScheme,
  probe: (url: string) => Promise<T>,
): Promise<{ readonly endpoint: Extract<EndpointCheck, { ok: true }>; readonly result: T }> {
  let failure: unknown;
  for (const candidate of endpointCandidates(typed, page)) {
    if (!candidate.ok) throw new Error(candidate.reason);
    try {
      return { endpoint: candidate, result: await probe(candidate.url) };
    } catch (error) {
      failure = error;
      if (error instanceof Error && error.message.startsWith('denied:credentials')) break;
    }
  }
  throw failure;
}
