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
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xe0000000, 3], // 224.0.0.0/3
];

function isPrivateIpv4(value: number): boolean {
  return BLOCKED_IPV4.some(([base, bits]) => value >>> (32 - bits) === base >>> (32 - bits));
}

/** Rewrites a dotted IPv4 tail (`::ffff:127.0.0.1`) as the two hex groups it stands for. */
function withHexTail(ip: string): string | undefined {
  if (!ip.includes('.')) return ip;
  const split = ip.lastIndexOf(':');
  const value = ipv4Value(ip.slice(split + 1));
  if (value === undefined) return undefined;
  return `${ip.slice(0, split + 1)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
}

/** The 128 bits of an IPv6 address as 32 lowercase hex digits, expanding `::` and a dotted tail. */
function ipv6Hex(ip: string): string | undefined {
  const text = withHexTail(ip);
  if (text === undefined) return undefined;
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(missing).fill('0'), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return undefined;
  return groups.map((group) => group.toLowerCase().padStart(4, '0')).join('');
}

/**
 * IPv6 prefixes (as hex digits) whose low 32 bits are an IPv4 address the
 * packet ends up at: IPv4-compatible `::/96`, IPv4-mapped `::ffff:0:0/96`,
 * IPv4-translated `::ffff:0:0:0/96` and the well-known NAT64 prefix
 * `64:ff9b::/96`. They are judged by the embedded IPv4 address, so NAT64
 * addresses a DNS64 resolver synthesises for public hosts stay reachable.
 */
const EMBEDDED_IPV4_PREFIXES: readonly string[] = ['0'.repeat(24), `${'0'.repeat(20)}ffff`, `${'0'.repeat(16)}ffff0000`, `0064ff9b${'0'.repeat(16)}`];

/**
 * IPv6 ranges blocked outright: link-local and deprecated site-local
 * (`fe80::/10`, `fec0::/10`), unique-local `fc00::/7`, multicast `ff00::/8`,
 * discard-only `100::/64`, local-use NAT64 `64:ff9b:1::/48`, and the two
 * tunnelling prefixes that carry an IPv4 address the bridge cannot vouch for,
 * 6to4 `2002::/16` and Teredo `2001::/32`. Both tunnels are deprecated, so
 * blocking them entirely is the safer choice over judging the embedded address.
 */
const BLOCKED_IPV6 = [/^fe[89a-f]/, /^f[cd]/, /^ff/, /^010{14}/, /^0064ff9b0001/, /^2002/, /^20010000/];

function isPrivateIpv6(hex: string): boolean {
  if (EMBEDDED_IPV4_PREFIXES.some((prefix) => hex.startsWith(prefix))) return isPrivateIpv4(Number.parseInt(hex.slice(24), 16));
  return BLOCKED_IPV6.some((range) => range.test(hex));
}

/**
 * Tells whether a literal IP address belongs to a range the bridge never contacts.
 *
 * IPv4: this network, private, shared, loopback, link-local, IETF protocol
 * assignments, benchmarking, multicast and reserved. IPv6 is parsed to its
 * full 128 bits first, so every spelling of an address, including the hex
 * form `new URL` normalises `[::ffff:127.0.0.1]` to (`::ffff:7f00:1`), is
 * judged the same way: an address that embeds an IPv4 destination (mapped,
 * compatible, translated, NAT64) is judged by that destination, and
 * link-local, site-local, unique-local, multicast, discard, local NAT64, 6to4
 * and Teredo ranges are blocked outright. A zone suffix (`%eth0`) is ignored.
 *
 * @param ip - A literal IPv4 or IPv6 address, with or without brackets.
 * @returns True when the address is blocked; false for public addresses and for strings that are not an IP.
 * @example
 * ```ts
 * isPrivateAddress('169.254.169.254'); // true
 * isPrivateAddress('[::ffff:7f00:1]'); // true
 * isPrivateAddress('93.184.216.34'); // false
 * ```
 */
export function isPrivateAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const value = ipv4Value(bare);
  if (value !== undefined) return isPrivateIpv4(value);
  const hex = ipv6Hex(bare);
  return hex !== undefined && isPrivateIpv6(hex);
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
 * In a browser the hop check needs the redirect itself, which the fetch API
 * hides: a redirect arrives as an opaque response and is refused with
 * `denied:redirect-unverifiable`. Cross-origin rules still apply there; a
 * request the browser blocks, or an opaque answer, is `unavailable:network`.
 * On a server, redirects arrive as 3xx with a location and are followed.
 *
 * The fetch API cannot pin a connection to a validated address, so the resolver
 * check narrows the DNS-rebinding window without closing it. kernl's shell wires
 * no resolver today, so hostnames are judged as literals only.
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
      // A browser answers `redirect: 'manual'` with an opaque redirect: status 0, no Location. The hop cannot be checked, so it is refused rather than followed blind.
      if (response.type === 'opaqueredirect') throw new Error('denied:redirect-unverifiable');
      if (response.status === 0) throw new Error(`unavailable:network ${response.type} response`);
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
