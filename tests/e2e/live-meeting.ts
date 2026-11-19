import type { Page, WebSocketRoute } from '@playwright/test';
import type { NostrEvent } from 'nostr-tools/pure';

/**
 * One relay that several pages under test share: each page's sockets to the named relays are
 * answered from the same store in the test process, so two shells can meet through it. It keeps
 * what it is sent and streams new matches. Nothing leaves the machine.
 */

interface Filter {
  readonly kinds?: number[];
  readonly since?: number;
  readonly [tag: `#${string}`]: string[] | undefined;
}

function matches(filter: Filter, event: NostrEvent): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  return Object.entries(filter).every(([key, values]) => !key.startsWith('#') || !Array.isArray(values)
    || event.tags.some((tag) => tag[0] === key.slice(1) && values.includes(tag[1] ?? '')));
}

export interface SharedRelay {
  /** Every event any page published, in arrival order. */
  readonly published: NostrEvent[];
  /** Route `urls` on `page` to this relay. */
  serve(page: Page, urls: readonly string[]): Promise<void>;
}

/**
 * Make a relay the pages of one test share.
 *
 * @returns The relay; call `serve` for each page.
 * @example
 * ```ts
 * const relay = sharedRelay();
 * await relay.serve(page, ['wss://relay.damus.io']);
 * ```
 */
export function sharedRelay(): SharedRelay {
  const stored: NostrEvent[] = [];
  const sockets = new Map<WebSocketRoute, Map<string, Filter[]>>();
  const store = (event: NostrEvent): void => {
    stored.push(event);
    for (const [socket, subs] of sockets) for (const [id, filters] of subs) if (filters.some((filter) => matches(filter, event))) socket.send(JSON.stringify(['EVENT', id, event]));
  };
  const answer = (socket: WebSocketRoute): void => {
    const subs = new Map<string, Filter[]>();
    sockets.set(socket, subs);
    socket.onClose(() => sockets.delete(socket));
    socket.onMessage((raw) => {
      const [verb, first, ...filters] = JSON.parse(String(raw)) as [string, unknown, ...Filter[]];
      if (verb === 'EVENT') {
        const event = first as NostrEvent;
        socket.send(JSON.stringify(['OK', event.id, true, '']));
        store(event);
      } else if (verb === 'CLOSE') subs.delete(first as string);
      else if (verb === 'REQ') {
        for (const event of stored) if (filters.some((filter) => matches(filter, event))) socket.send(JSON.stringify(['EVENT', first, event]));
        socket.send(JSON.stringify(['EOSE', first]));
        subs.set(first as string, filters);
      }
    });
  };
  return {
    published: stored,
    async serve(page, urls) {
      for (const url of urls) await page.routeWebSocket(url, answer);
    },
  };
}

/**
 * An applet that opens the room `room`, says who it is to everyone who joins, and writes what it
 * hears into `#out`, one line each.
 *
 * @param room - The room both copies open.
 * @returns The applet's HTML.
 * @example
 * ```ts
 * signApplet({ servers, optional: ['webrtc'], html: meetingApplet('lobby-1234') });
 * ```
 */
export function meetingApplet(room: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Meeting</title></head><body><h1>Meeting</h1><pre id="out"></pre><script>
(async () => {
  const out = document.getElementById('out');
  const show = (line) => { out.textContent += line + '\\n'; };
  try {
    const { session } = await window.napplet.webrtc.open({ scope: { type: 'room', room: ${JSON.stringify(room)} } });
    show('opened');
    window.napplet.webrtc.onEvent((event) => {
      if (event.type === 'peer' && event.state === 'joined') {
        show('joined');
        window.napplet.webrtc.send(session.id, { hello: 'from the other side' });
      }
      if (event.type === 'message') show('message ' + JSON.stringify(event.payload));
    });
  } catch (error) {
    show('failed: ' + error.message);
  }
})();
</script></body></html>`;
}
