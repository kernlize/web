import type { MailBackend, NzbBackend, SoulseekBackend, TorrentBackend } from './types';

/**
 * Opens a URI with whatever app the user's device registers for it. The shell's opener
 * asks the user before leaving kernl.
 */
export type HandoffOpener = (uri: string) => void | Promise<void>;

/** The four backends {@link createHandoffBackends} returns. */
export interface HandoffBackends {
  readonly torrent: TorrentBackend;
  readonly soulseek: SoulseekBackend;
  readonly mail: MailBackend;
  readonly nzb: NzbBackend;
}

function lastSegment(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? '';
}

function query(pairs: readonly (readonly [string, string | undefined])[]): string {
  const present = pairs.filter((pair): pair is readonly [string, string] => pair[1] !== undefined);
  return present.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}

/**
 * Builds the canonical magnet link from parsed fields, so the opened URI carries only
 * what kernl understood: the hash, the display name and the trackers.
 */
function magnetUri(infoHash: string, trackers: readonly string[], name: string | undefined): string {
  const rest = query([['dn', name], ...trackers.map((tracker) => ['tr', tracker] as const)]);
  return `magnet:?xt=urn:btih:${infoHash}${rest ? `&${rest}` : ''}`;
}

function soulseekUri(user: string, path: string): string {
  return `slsk://${encodeURIComponent(user)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function mailUri(address: string, subject: string | undefined, body: string | undefined): string {
  const rest = query([
    ['subject', subject],
    ['body', body],
  ]);
  return `mailto:${encodeURI(address)}${rest ? `?${rest}` : ''}`;
}

function httpsUrl(url: string): string {
  if (!url.startsWith('https://')) throw new Error('invalid:nzb-not-https');
  return url;
}

/**
 * Creates backends that resolve a locator by handing it to an app on the user's device:
 * each rebuilds the canonical URI from the parsed fields and opens it once. kernl moves
 * no data itself, so the bridges report `{ available: true, handoff: true }` (D-010).
 * An NZB opens through its https address so the device's NZB client or browser takes it.
 *
 * @param open - Opens a URI on the device; the shell passes its confirm-before-leaving opener.
 * @returns A torrent, sharing, mail and NZB backend sharing one `handoff:<n>` id counter.
 * @throws `invalid:nzb-not-https` from the NZB backend when the document is not served over https.
 * @example
 * ```ts
 * const backends = createHandoffBackends((uri) => window.open(uri, '_blank', 'noopener'));
 * const bridge = createTorrentBridge(backends.torrent);
 * await bridge.resolve(parseLocator('magnet:?xt=urn:btih:' + 'ab'.repeat(20) + '&dn=Film'), { requester: 'shell' });
 * // opens magnet:?xt=urn:btih:abab…&dn=Film and yields { kind: 'job', id: 'handoff:1', label: 'Film' }
 * ```
 */
export function createHandoffBackends(open: HandoffOpener): HandoffBackends {
  let count = 0;
  const handOff = async (uri: string): Promise<string> => {
    await open(uri);
    count += 1;
    return `handoff:${count}`;
  };
  return {
    torrent: {
      handoff: true,
      add: async (infoHash, trackers, _context, name) => ({
        id: await handOff(magnetUri(infoHash, trackers, name)),
        name: name ?? infoHash,
      }),
    },
    soulseek: {
      handoff: true,
      download: async (user, path) => ({ id: await handOff(soulseekUri(user, path)), name: lastSegment(path) || user }),
    },
    mail: {
      handoff: true,
      open: async (address, subject, _context, body) => ({ id: await handOff(mailUri(address, subject, body)) }),
    },
    nzb: {
      handoff: true,
      add: async (url) => {
        const target = new URL(httpsUrl(url));
        return { id: await handOff(target.href), name: lastSegment(target.pathname) || target.host };
      },
    },
  };
}
