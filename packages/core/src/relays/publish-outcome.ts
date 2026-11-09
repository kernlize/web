import { normalizeRelayUrl } from 'applesauce-core/helpers';

/** What came of one publish across several servers. */
export interface PublishOutcome {
  /** Servers that accepted the event, normalised, in the order they answered. */
  readonly accepted: readonly string[];
  /** Servers that refused it, each with the server's own reason or `refused`. */
  readonly refused: readonly { url: string; reason: string }[];
  /** True when at least one server accepted it (D-028). */
  readonly ok: boolean;
}

/** One server's answer, as applesauce-relay's `PublishResponse` carries it. */
export interface PublishAnswer {
  readonly ok: boolean;
  readonly from: string;
  readonly message?: string;
}

/**
 * The server URL in its normalised form, or as given when it is not a server URL.
 *
 * @param url - A server URL as written anywhere.
 * @returns The normalised URL, or `url` unchanged.
 * @example
 * ```ts
 * relayKey('wss://Relay.Example'); // 'wss://relay.example/'
 * relayKey('not a server'); // 'not a server'
 * ```
 */
export function relayKey(url: string): string {
  return toRelayUrl(url) ?? url;
}

/**
 * A server URL in its normalised form, when it is one. Only `ws:` and `wss:`
 * count: applesauce's normaliser would turn `https://` or a bare word into a
 * server address, and NIP-66 lets a report name a server by pubkey.
 *
 * @param url - A server URL as written anywhere.
 * @returns The normalised URL, or undefined.
 * @example
 * ```ts
 * toRelayUrl('wss://Relay.Example'); // 'wss://relay.example/'
 * toRelayUrl('https://relay.example'); // undefined
 * ```
 */
export function toRelayUrl(url: string): string | undefined {
  if (!/^wss?:\/\//i.test(url.trim())) return undefined;
  try {
    return normalizeRelayUrl(url);
  } catch {
    return undefined;
  }
}

/**
 * Normalise a list of server URLs, dropping duplicates and anything that is not a server URL.
 *
 * @param urls - Server URLs as written anywhere.
 * @returns The normalised URLs, first occurrence first.
 * @example
 * ```ts
 * relayUrls(['wss://a.example', 'wss://A.example/', 'https://b.example']); // ['wss://a.example/']
 * ```
 */
export function relayUrls(urls: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const url of urls) {
    const normalized = toRelayUrl(url);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

/**
 * Fold the servers' answers to one publish into an outcome. A server that
 * answered more than once counts once, and an acceptance wins over a refusal,
 * because the event is on that server either way.
 *
 * @param responses - The answers `RelayPool.publish` resolved with.
 * @returns Who accepted, who refused and why, and whether anyone accepted.
 * @example
 * ```ts
 * const outcome = summarizePublish(await pool.publish(relays, event));
 * outcome.ok; // true when 2 of 3 accepted
 * ```
 */
export function summarizePublish(responses: readonly PublishAnswer[]): PublishOutcome {
  const accepted: string[] = [];
  const refused = new Map<string, string>();
  for (const response of responses) {
    const url = relayKey(response.from);
    if (accepted.includes(url)) continue;
    if (response.ok) {
      accepted.push(url);
      refused.delete(url);
    } else {
      refused.set(url, response.message || 'refused');
    }
  }
  return {
    accepted,
    refused: [...refused].map(([url, reason]) => ({ url, reason })),
    ok: accepted.length > 0,
  };
}

/**
 * Say what came of a publish in words for the person. The sentence never
 * repeats a server's reason, which is written for developers and often names
 * the protocol.
 *
 * @param outcome - The result of {@link summarizePublish}.
 * @returns A sentence such as `Saved to 2 of 3 servers` or `No server accepted it`.
 * @example
 * ```ts
 * describeOutcome({ accepted: ['wss://a/'], refused: [{ url: 'wss://b/', reason: 'blocked' }], ok: true });
 * // 'Saved to 1 of 2 servers'
 * ```
 */
export function describeOutcome(outcome: PublishOutcome): string {
  const total = outcome.accepted.length + outcome.refused.length;
  if (total === 0) return 'There was no server to save it to';
  if (!outcome.ok) return 'No server accepted it';
  if (outcome.refused.length > 0) return `Saved to ${outcome.accepted.length} of ${total} servers`;
  return total === 1 ? 'Saved to 1 server' : `Saved to all ${total} servers`;
}
