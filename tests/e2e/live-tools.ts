import type { Page, WebSocketRoute } from '@playwright/test';
import { nip19, nip44 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type NostrEvent } from 'nostr-tools/pure';

/**
 * A relay inside the browser under test that keeps what it is sent and streams new matches, with a
 * tool server behind it that speaks the real wire: announcements, then sealed requests and answers.
 * Nothing leaves the machine.
 */

const KIND_TOOL_MESSAGE = 25910;
const KIND_SEALED = 21059;

interface Filter {
  readonly kinds?: number[];
  readonly authors?: string[];
  readonly since?: number;
  readonly [tag: `#${string}`]: string[] | undefined;
}

function matches(filter: Filter, event: NostrEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  return Object.entries(filter).every(([key, values]) => !key.startsWith('#') || !Array.isArray(values)
    || event.tags.some((tag) => tag[0] === key.slice(1) && values.includes(tag[1] ?? '')));
}

export interface ToolServer {
  readonly pubkey: string;
  /** A shareable reference to the tool list, hinting the relay it is on. */
  readonly reference: string;
  /** The keys requests were signed by. */
  readonly callers: Set<string>;
  /** Every event the shell published to the relay. */
  readonly published: NostrEvent[];
}

const now = (): number => Math.floor(Date.now() / 1000);

/**
 * Route `url` to a storing relay and put a tool server named `name` behind it, whose `tool` answers `answer`.
 *
 * @param page - The page under test.
 * @param url - The relay's `wss://` URL.
 * @param tool - The tool's name and answer.
 * @returns What the server saw.
 * @example
 * ```ts
 * const server = await installToolServer(page, 'wss://tools.test', { name: 'Trust fixture', tool: 'trust_score', answer: '0.87' });
 * ```
 */
export async function installToolServer(page: Page, url: string, tool: { readonly name: string; readonly tool: string; readonly answer: string }): Promise<ToolServer> {
  const secret = generateSecretKey();
  const listed = [{ name: tool.tool, inputSchema: { type: 'object' } }];
  const toolList = finalizeEvent({ kind: 11317, created_at: now(), tags: [], content: JSON.stringify({ tools: listed }) }, secret);
  const server: ToolServer = { pubkey: getPublicKey(secret), reference: nip19.neventEncode({ id: toolList.id, relays: [url] }), callers: new Set(), published: [] };
  const stored: NostrEvent[] = [
    finalizeEvent({ kind: 11316, created_at: now(), tags: [['name', tool.name], ['about', 'Trust scores']], content: '{}' }, secret),
    toolList,
  ];
  const sockets = new Map<WebSocketRoute, Map<string, Filter[]>>();
  const store = (event: NostrEvent): void => {
    stored.push(event);
    for (const [socket, subs] of sockets) for (const [id, filters] of subs) if (filters.some((filter) => matches(filter, event))) socket.send(JSON.stringify(['EVENT', id, event]));
  };
  const seal = (to: string, message: unknown): NostrEvent => {
    const inner = finalizeEvent({ kind: KIND_TOOL_MESSAGE, created_at: now(), tags: [['p', to]], content: JSON.stringify(message) }, secret);
    const wrapper = generateSecretKey();
    return finalizeEvent({ kind: KIND_SEALED, created_at: now(), tags: [['p', to]], content: nip44.v2.encrypt(JSON.stringify(inner), nip44.v2.utils.getConversationKey(wrapper, to)) }, wrapper);
  };
  const answer = (wrap: NostrEvent): void => {
    if (wrap.kind !== KIND_SEALED || !wrap.tags.some((tag) => tag[0] === 'p' && tag[1] === server.pubkey)) return;
    const inner = JSON.parse(nip44.v2.decrypt(wrap.content, nip44.v2.utils.getConversationKey(secret, wrap.pubkey))) as NostrEvent;
    if (!verifyEvent(inner) || inner.kind !== KIND_TOOL_MESSAGE) return;
    server.callers.add(inner.pubkey);
    const request = JSON.parse(inner.content) as { id?: number | string; method?: string; params?: { name?: string } };
    if (request.id === undefined) return;
    const result = request.method === 'initialize'
      ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : request.method === 'tools/list' ? { tools: listed }
        : request.method === 'tools/call' && request.params?.name === tool.tool ? { content: [{ type: 'text', text: tool.answer }] } : undefined;
    store(seal(inner.pubkey, result ? { jsonrpc: '2.0', id: request.id, result } : { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'method not found' } }));
  };
  await page.routeWebSocket(url, (socket) => {
    const subs = new Map<string, Filter[]>();
    sockets.set(socket, subs);
    socket.onClose(() => sockets.delete(socket));
    socket.onMessage((raw) => {
      const [verb, first, ...filters] = JSON.parse(String(raw)) as [string, unknown, ...Filter[]];
      if (verb === 'EVENT') {
        const event = first as NostrEvent;
        socket.send(JSON.stringify(['OK', event.id, true, '']));
        server.published.push(event);
        store(event);
        answer(event);
      } else if (verb === 'CLOSE') subs.delete(first as string);
      else if (verb === 'REQ') {
        for (const event of stored) if (filters.some((filter) => matches(filter, event))) socket.send(JSON.stringify(['EVENT', first, event]));
        socket.send(JSON.stringify(['EOSE', first]));
        subs.set(first as string, filters);
      }
    });
  });
  return server;
}

/**
 * An applet that looks for remote tools on `relay`, calls `tool` on the first server it finds and
 * writes what happened into `#out`.
 *
 * @param relay - Where the applet looks.
 * @param tool - The tool it calls.
 * @returns The applet's HTML.
 * @example
 * ```ts
 * signApplet({ servers, optional: ['cvm'], html: toolCallingApplet('wss://tools.test', 'trust_score') });
 * ```
 */
export function toolCallingApplet(relay: string, tool: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Scores</title></head><body><h1>Scores</h1><p id="out">waiting</p><script>
(async () => {
  const out = document.getElementById('out');
  try {
    const [server] = await window.napplet.cvm.discover({ relays: [${JSON.stringify(relay)}] });
    const result = await window.napplet.cvm.callTool(server, ${JSON.stringify(tool)}, {}, { initialize: true });
    out.textContent = 'score ' + result.content[0].text;
  } catch (error) {
    out.textContent = 'failed: ' + error.message;
  }
})();
</script></body></html>`;
}

/**
 * An applet that asks the shell for the tool family `family` and runs `tool` through it, writing what
 * happened into `#out`.
 *
 * @param family - The name the person gave the tools.
 * @param tool - The tool it runs.
 * @returns The applet's HTML.
 * @example
 * ```ts
 * signApplet({ servers, optional: ['cvm'], html: familyCallingApplet('trust', 'trust_score') });
 * ```
 */
export function familyCallingApplet(family: string, tool: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Scores</title></head><body><h1>Scores</h1><p id="out">waiting</p><script>
(async () => {
  const out = document.getElementById('out');
  try {
    const result = await window.napplet.cvm.registry.call({ family: ${JSON.stringify(family)} }, ${JSON.stringify(tool)}, {});
    out.textContent = 'score ' + result.content[0].text;
  } catch (error) {
    out.textContent = 'failed: ' + error.message;
  }
})();
</script></body></html>`;
}
