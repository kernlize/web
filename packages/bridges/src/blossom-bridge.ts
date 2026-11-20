import { createHttpBridge, type HttpBridgeOptions } from './http-bridge';
import { parseLocator } from './locator';
import type { Bridge, BridgeContext, BridgeResult } from './types';

/** A Blossom blob reference: its hash, the extension it was named with, and the servers it hints at. */
export interface BlossomReference {
  /** Lowercase hex SHA-256 of the blob. */
  readonly sha256: string;
  /** The extension with its dot (`.png`), or empty when the reference names none. */
  readonly extension: string;
  /** `xs` hints, as `https://` origins, in the order given. */
  readonly servers: readonly string[];
}

/** Construction options for the Blossom bridge. */
export interface BlossomBridgeOptions {
  /** Policy, fetch and host resolver for the web requests the bridge makes; the web bridge's defaults otherwise. */
  readonly http?: HttpBridgeOptions;
  /** Servers to try for a requester after the reference's own hints, such as an applet's manifest servers. */
  readonly serversFor?: (requester: BridgeContext['requester']) => readonly string[];
}

/*
 * BUD-10 names a blob `blossom:<sha256>.<ext>`, with an extension. Applets that
 * work in other shells also send `blossom:sha256:<sha256>` and leave the
 * extension off, so both are read. That form is not in BUD-10; it is accepted
 * here because refusing it breaks published applets, not because the spec
 * allows it (D-055).
 */
const REFERENCE = /^blossom:(?:sha256:)?([0-9a-f]{64})(\.[a-z0-9]{1,16})?(?:\?([^#]*))?$/i;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.wasm': 'application/wasm',
};

function hintOrigin(hint: string): string | undefined {
  const url = URL.parse(/^[a-z][a-z0-9+.-]*:\/\//i.test(hint) ? hint : `https://${hint}`);
  return url && url.protocol === 'https:' ? url.origin : undefined;
}

/**
 * Reads a Blossom reference: BUD-10's `blossom:<sha256>.<ext>?xs=…`, and the
 * `blossom:sha256:<sha256>` form published applets also use, with or without an
 * extension. Hints that are not `https:` servers are dropped.
 *
 * @param uri - The reference.
 * @returns Its hash, extension and server hints.
 * @throws `invalid:blossom` when the string is not a Blossom reference.
 * @example
 * ```ts
 * parseBlossomReference(`blossom:${hash}.png?xs=cdn.example.com`).servers; // ['https://cdn.example.com']
 * parseBlossomReference(`blossom:sha256:${hash}`).extension; // ''
 * ```
 */
export function parseBlossomReference(uri: string): BlossomReference {
  const match = REFERENCE.exec(uri);
  if (!match?.[1]) throw new Error('invalid:blossom');
  const hints = new URLSearchParams(match[3] ?? '').getAll('xs').map(hintOrigin);
  return {
    sha256: match[1].toLowerCase(),
    extension: (match[2] ?? '').toLowerCase(),
    servers: hints.filter((origin): origin is string => origin !== undefined),
  };
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function serverBase(server: string): string | undefined {
  const url = URL.parse(server);
  return url ? `${url.origin}${url.pathname.replace(/\/+$/, '')}` : undefined;
}

/** The servers to ask, hints first, each once. */
function candidates(reference: BlossomReference, extra: readonly string[]): readonly string[] {
  const bases = [...reference.servers, ...extra].map(serverBase);
  return [...new Set(bases.filter((base): base is string => base !== undefined))];
}

/**
 * Creates the bridge for `blossom:` references (D-055). It asks the
 * reference's `xs` hints, then the servers `serversFor` names for the
 * requester, in that order, through the web bridge's policy, and returns the
 * first blob whose SHA-256 matches the reference. A server that answers with
 * other bytes is passed over: servers are accelerators, never identity. No
 * other server is asked, so a hash is never revealed to a server the applet
 * and its publisher did not name.
 *
 * @param options - The web policy to fetch under, and the servers to try for a requester.
 * @returns A bridge with id `blossom` labelled `files`.
 * @example
 * ```ts
 * const bridge = createBlossomBridge({ serversFor: (requester) => manifestServersOf(requester) });
 * const result = await bridge.resolve(parseLocator(`blossom:${hash}.png`), { requester: { dTag: 'game', hash: aggregate } });
 * ```
 */
export function createBlossomBridge(options: BlossomBridgeOptions = {}): Bridge {
  const web = createHttpBridge(options.http);

  /** The blob from one server, or undefined when that server did not give it: missing, refused by policy, unreachable or other bytes. */
  const fromServer = async (base: string, reference: BlossomReference, context: BridgeContext): Promise<ArrayBuffer | undefined> => {
    try {
      const result = await web.resolve(parseLocator(`${base}/${reference.sha256}`), context);
      if (result.kind !== 'bytes' || !result.response.ok) return undefined;
      const bytes = await result.response.arrayBuffer();
      return hex(await crypto.subtle.digest('SHA-256', bytes)) === reference.sha256 ? bytes : undefined;
    } catch (error) {
      // The caller giving up ends the search; any other failure is this server's, and the next one gets its turn.
      if (context.signal?.aborted) throw error;
      return undefined;
    }
  };

  return {
    id: 'blossom',
    label: 'files',
    schemes: ['blossom'],
    exposure: { revealsAddress: true, encryptedInTransit: true, publicActivity: false },
    availability: () => ({ available: true }),
    async resolve(locator, context): Promise<BridgeResult> {
      const reference = parseBlossomReference(locator.raw);
      const servers = candidates(reference, options.serversFor?.(context.requester) ?? []);
      if (servers.length === 0) throw new Error('unavailable:no-servers');
      for (const base of servers) {
        const found = await fromServer(base, reference, context);
        if (found === undefined) continue;
        const type = MIME_BY_EXTENSION[reference.extension] ?? 'application/octet-stream';
        return { kind: 'bytes', response: new Response(found, { headers: { 'content-type': type } }) };
      }
      throw new Error('unavailable:not-found');
    },
  };
}
