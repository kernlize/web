import type { Bridge, BridgeContext, BridgeResult, HttpPolicy, Locator } from './types';

/**
 * The limits the HTTP bridge enforces unless the shell loosens them: encrypted
 * transport only, three redirects, 10 MiB per response, 20 seconds per request,
 * and no private destinations.
 */
export const DEFAULT_HTTP_POLICY: HttpPolicy = {
  allowedSchemes: ['https:'],
  maxRedirects: 3,
  maxBytes: 10 * 1024 * 1024,
  timeoutMs: 20_000,
  allowPrivateHosts: [],
};

/** Construction options for the HTTP bridge. */
export interface HttpBridgeOptions {
  /** Overrides merged over `DEFAULT_HTTP_POLICY`. */
  readonly policy?: Partial<HttpPolicy>;
  /** The fetch implementation; the global one by default. */
  readonly fetch?: typeof fetch;
  /** Resolves a hostname to its addresses so that names pointing at private ranges are blocked. */
  readonly resolveHost?: (host: string) => Promise<readonly string[]>;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal'];

function ipv4Value(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : 256));
  if (octets.some((octet) => octet > 255)) return undefined;
  return octets.reduce((value, octet) => value * 256 + octet, 0);
}

const BLOCKED_IPV4: readonly (readonly [base: number, bits: number])[] = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xe0000000, 3], // 224.0.0.0/3
];

function isPrivateIpv4(value: number): boolean {
  return BLOCKED_IPV4.some(([base, bits]) => value >>> (32 - bits) === base >>> (32 - bits));
}

function ipv6Hex(ip: string): string | undefined {
  const halves = ip.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return undefined;
  return groups.map((group) => group.toLowerCase().padStart(4, '0')).join('');
}

const BLOCKED_IPV6 = [/^0{31}[01]$/, /^fe[89ab]/, /^f[cd]/, /^ff/];

/**
 * Tells whether a literal IP address belongs to a range the bridge never contacts:
 * unspecified, loopback, private, shared, link-local, unique-local, multicast or
 * reserved, for both IPv4 and IPv6 (including IPv4-mapped IPv6 addresses).
 *
 * @param ip - A literal IPv4 or IPv6 address, with or without brackets.
 * @returns True when the address is blocked; false for public addresses and for strings that are not an IP.
 * @example
 * ```ts
 * isPrivateAddress('169.254.169.254'); // true
 * isPrivateAddress('[fe80::1]'); // true
 * isPrivateAddress('93.184.216.34'); // false
 * ```
 */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '');
  if (bare.includes(':') && bare.includes('.')) return isPrivateAddress(bare.slice(bare.lastIndexOf(':') + 1));
  const value = ipv4Value(bare);
  if (value !== undefined) return isPrivateIpv4(value);
  const hex = ipv6Hex(bare);
  return hex !== undefined && BLOCKED_IPV6.some((range) => range.test(hex));
}

/**
 * Tells whether a hostname names the local machine or a local network by convention.
 *
 * @param host - A hostname, in any case, with or without a trailing dot.
 * @returns True for `localhost` and names under `.localhost`, `.local` or `.internal`.
 * @example
 * ```ts
 * isBlockedHostname('printer.local'); // true
 * isBlockedHostname('example.com'); // false
 * ```
 */
export function isBlockedHostname(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '');
  return name === 'localhost' || BLOCKED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

function abortReason(signals: { timeout: AbortSignal; caller: AbortSignal | undefined }, error: unknown): Error {
  if (signals.timeout.aborted) return new Error('unavailable:timeout');
  if (signals.caller?.aborted) return new Error('unavailable:aborted');
  return new Error(`unavailable:network ${error instanceof Error ? error.message : String(error)}`);
}

function limitBody(response: Response, maxBytes: number): Response {
  let seen = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) controller.error(new Error('denied:too-large'));
      else controller.enqueue(chunk);
    },
  });
  return new Response(response.body ? response.body.pipeThrough(counter) : null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Creates the bridge that fetches web resources under an SSRF policy: allowed
 * schemes only, no private or local destinations (checked again on every redirect
 * hop and, when a resolver is supplied, after name resolution), a redirect cap, a
 * time limit and a byte limit enforced on the streamed body.
 *
 * The fetch API cannot pin a connection to a validated address, so the resolver
 * check narrows the DNS-rebinding window without closing it; the shell closes it
 * by also fetching through a guard that resolves names once.
 *
 * @param options - Policy overrides, a fetch implementation and an optional host resolver.
 * @returns A bridge with id `http` labelled `downloads`.
 * @example
 * ```ts
 * const bridge = createHttpBridge({
 *   resolveHost: async (host) => (await dns.promises.lookup(host, { all: true })).map((entry) => entry.address),
 * });
 * const result = await bridge.resolve(parseLocator('https://example.com/data.json'), { requester: 'shell' });
 * ```
 */
export function createHttpBridge(options: HttpBridgeOptions = {}): Bridge {
  const policy: HttpPolicy = { ...DEFAULT_HTTP_POLICY, ...options.policy };
  const fetchImpl = options.fetch ?? fetch;

  const assertAllowed = async (url: URL): Promise<void> => {
    if (!policy.allowedSchemes.includes(url.protocol)) throw new Error(`denied:scheme ${url.protocol}`);
    const host = hostOf(url);
    if (policy.allowPrivateHosts.includes(host)) return;
    if (isBlockedHostname(host) || isPrivateAddress(host)) throw new Error(`denied:private-address ${host}`);
    const addresses = options.resolveHost ? await options.resolveHost(host) : [];
    const blocked = addresses.find(isPrivateAddress);
    if (blocked !== undefined) throw new Error(`denied:private-address ${host} -> ${blocked}`);
  };

  const follow = async (locator: Locator, context: BridgeContext): Promise<Response> => {
    const signals = { timeout: AbortSignal.timeout(policy.timeoutMs), caller: context.signal };
    const signal = context.signal ? AbortSignal.any([signals.timeout, context.signal]) : signals.timeout;
    const headers = context.headers ? { headers: context.headers } : {};
    let url = new URL(locator.raw);
    for (let hop = 0; ; hop += 1) {
      await assertAllowed(url);
      const response = await fetchImpl(url, { redirect: 'manual', signal, ...headers }).catch((error: unknown) => {
        throw abortReason(signals, error);
      });
      if (!REDIRECT_STATUSES.has(response.status)) return response;
      if (hop >= policy.maxRedirects) throw new Error('denied:too-many-redirects');
      const location = response.headers.get('location');
      const target = location === null ? null : URL.parse(location, url);
      if (!target) throw new Error('invalid:redirect');
      url = target;
    }
  };

  return {
    id: 'http',
    label: 'downloads',
    schemes: ['https', 'http'].filter((scheme) => policy.allowedSchemes.includes(`${scheme}:`)),
    exposure: {
      revealsAddress: true,
      encryptedInTransit: !policy.allowedSchemes.includes('http:'),
      publicActivity: false,
    },
    availability: () => ({ available: true }),
    async resolve(locator, context): Promise<BridgeResult> {
      const response = await follow(locator, context);
      if (Number(response.headers.get('content-length')) > policy.maxBytes) throw new Error('denied:too-large');
      return { kind: 'bytes', response: limitBody(response, policy.maxBytes) };
    },
  };
}
