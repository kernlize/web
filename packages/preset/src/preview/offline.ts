import type { BridgeRegistry, ClientFetch, TorrentBackend } from '@kernlize/bridges';
import { createDefaultBridges, multiplayerModule, filesModule, type AccountFileServers, type KernlMultiplayer } from '@kernlize/modules';
import type { KernlModule } from '@kernlize/kernel';

/** What every request that would leave the page is refused with. */
const OFFLINE = 'unavailable:preview';

/** The version every download program reports in the preview; uTorrent reports only a build number. */
const VERSION = 'preview';

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** The JSON-RPC method a Transmission or NZBGet request names; both always send a JSON body. */
const methodOf = (init: RequestInit | undefined): unknown => (JSON.parse(String(init?.body)) as { method?: unknown }).method;

/** The answer each program gives to the one request its check sends, keyed by how the request looks. */
function probeAnswer(url: URL, init: RequestInit | undefined): Response | undefined {
  const path = url.pathname;
  if (path.endsWith('/gui/token.html')) return new Response(`<div id="token">${VERSION}</div>`, { status: 200 });
  if (path.endsWith('/gui/') && url.searchParams.get('list') === '1') return json({ build: 0, torrents: [] });
  if (path.endsWith('/jsonrpc')) return methodOf(init) === 'version' ? json({ result: VERSION }) : undefined;
  if (path.endsWith('/rpc')) return methodOf(init) === 'session-get' ? json({ result: 'success', arguments: { version: VERSION } }) : undefined;
  if (path.endsWith('/api/v0/session')) return json({ token: VERSION });
  if (path.endsWith('/api/v0/application')) return json({ version: { current: VERSION } });
  // SABnzbd's check asks for the queue; an empty one is the truth of a program that holds nothing.
  if (path.endsWith('/api')) return String(init?.body).includes('mode=queue') ? json({ queue: { version: VERSION, slots: [] } }) : undefined;
  return undefined;
}

/**
 * The `fetch` the preview's download programs go through: each program's check is answered as
 * that program would answer it, and everything else is refused as offline, so the form can be
 * tried and nothing leaves the page.
 *
 * @param input - The address the client asks.
 * @param init - The request.
 * @returns The program's answer to its check.
 */
export const offlineDownloadsFetch: ClientFetch = async (input, init) => {
  const answer = probeAnswer(new URL(input), init);
  if (!answer) throw new TypeError(OFFLINE);
  return answer;
};

const offlineFetch: typeof fetch = () => Promise.reject(new TypeError(OFFLINE));

/**
 * The bridges over a web bridge that reaches nothing: a web page or a Blossom blob an applet asks
 * for is refused as offline, and a link handed to an app on the device still goes through the
 * host's `openLink`, which asks first.
 *
 * @param torrent - The engine for magnet links, when the host has one.
 * @returns The `bridges` module.
 */
export function offlineBridgesModule(torrent?: TorrentBackend): KernlModule<'bridges', BridgeRegistry> {
  return {
    id: 'bridges',
    setup: (context) => ({ api: createDefaultBridges({ http: { fetch: offlineFetch }, handoff: (uri) => context.host.openLink(uri), ...(torrent ? { torrent } : {}) }) }),
  };
}

/**
 * The person's file servers without the `upload` domain: every file server is on the network.
 *
 * @returns The `files` module, offering no domain.
 */
export function offlineFilesModule(): KernlModule<'files', AccountFileServers> {
  const files = filesModule();
  return {
    ...files,
    setup(context) {
      const { services: _upload, ...rest } = files.setup(context);
      return rest;
    },
  };
}

/**
 * Remote tools and direct connections over the page's relays, where a search for tool families,
 * which would fetch from the web, says it is offline.
 *
 * @returns The `multiplayer` module.
 */
export function offlineMultiplayerModule(): KernlModule<'multiplayer', KernlMultiplayer> {
  const multiplayer = multiplayerModule();
  return {
    ...multiplayer,
    setup(context) {
      const instance = multiplayer.setup(context);
      return { ...instance, api: { ...(instance.api as KernlMultiplayer), discover: () => Promise.reject(new Error(OFFLINE)) } };
    },
  };
}
