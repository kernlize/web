import type { Page, WebSocketRoute } from '@playwright/test';
import { nip04 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey, type VerifiedEvent } from 'nostr-tools/pure';

/** Someone the test owns the key of, who writes the older, unsealed kind of message. */
export interface Correspondent {
  readonly pubkey: string;
  /** A message to `recipient`, encrypted and signed for real. */
  write(recipient: string, text: string, createdAt: number): Promise<VerifiedEvent>;
  /** Open a message `sender` wrote to this correspondent. */
  read(event: VerifiedEvent): Promise<string>;
}

export function correspondent(): Correspondent {
  const secret = generateSecretKey();
  return {
    pubkey: getPublicKey(secret),
    async write(recipient, text, createdAt) {
      return finalizeEvent({ kind: 4, created_at: createdAt, tags: [['p', recipient]], content: await nip04.encrypt(secret, recipient, text) }, secret);
    },
    read: (event) => nip04.decrypt(secret, event.pubkey, event.content),
  };
}

interface Filter {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  '#p'?: string[];
}

function matches(filter: Filter, event: VerifiedEvent): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  const tagged = filter['#p'];
  return !tagged || event.tags.some((tag) => tag[0] === 'p' && tagged.includes(tag[1] ?? ''));
}

export interface Mailbox {
  /** Everything the shell published, in order, once per event however many relays it went to. */
  readonly published: VerifiedEvent[];
}

/**
 * Every relay the shell knows, as one mailbox that exists only in this browser: it serves what it
 * holds, keeps what is published to it and says so. The shell's pool, its signer and its message
 * backends run for real against it; nothing leaves the machine.
 */
export async function mailbox(page: Page, held: readonly VerifiedEvent[]): Promise<Mailbox> {
  const events = [...held];
  const box: Mailbox = { published: [] };
  await page.routeWebSocket(/^wss:\/\//, (socket: WebSocketRoute) => {
    socket.onMessage((raw) => {
      const [verb, ...rest] = JSON.parse(String(raw)) as [string, ...unknown[]];
      if (verb === 'REQ') {
        const [subId, ...filters] = rest as [string, ...Filter[]];
        for (const event of events) if (filters.some((filter) => matches(filter, event))) socket.send(JSON.stringify(['EVENT', subId, event]));
        socket.send(JSON.stringify(['EOSE', subId]));
      }
      if (verb === 'EVENT') {
        const event = rest[0] as VerifiedEvent;
        if (!events.some((known) => known.id === event.id)) {
          events.push(event);
          box.published.push(event);
        }
        socket.send(JSON.stringify(['OK', event.id, true, '']));
      }
    });
  });
  return box;
}
