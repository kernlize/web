import type { SoulseekClient, SoulseekClientFile, SoulseekClientTransfer } from '@kernlize/bridges';

type Method = keyof SoulseekClient;

/** How a peer answers when asked for its list. */
export type PeerMood = 'sharing' | 'offline' | 'refusing' | 'silent';

interface MemorySearch {
  readonly text: string;
  readonly username?: string;
  readonly files: SoulseekClientFile[];
  complete: boolean;
}

/**
 * A Soulseek daemon kept in memory: it holds searches and transfers the way slskd does,
 * under ids of its own, and the steps play the network by delivering results, moving
 * transfers along and breaking things.
 */
export interface MemorySoulseekClient extends SoulseekClient {
  signedIn: boolean;
  /** False: nothing answers, every call rejects `unavailable:unreachable`. */
  reachable: boolean;
  /** True: every call rejects `denied:credentials`. */
  refusesSignIn: boolean;
  /** True: asking again for a file whose transfer was stopped revives that transfer under its old id. */
  revives: boolean;
  readonly calls: Array<{ readonly method: Method; readonly args: readonly unknown[] }>;
  readonly searches: Map<string, MemorySearch>;
  readonly transfers: Map<string, SoulseekClientTransfer>;
  readonly peers: Map<string, { mood: PeerMood; files: SoulseekClientFile[] }>;
  /** Peers answer every running search for these words. */
  deliver(text: string, files: readonly SoulseekClientFile[]): void;
  /** The daemon ends every search for these words by itself. */
  finishSearch(text: string): void;
  /** The newest transfer the daemon holds for a path. */
  transferOf(path: string): SoulseekClientTransfer;
  /** Changes what the daemon reports for the newest transfer of a path. */
  advance(path: string, change: Partial<SoulseekClientTransfer>): void;
  /** The daemon loses its record of the newest transfer of a path. */
  lose(path: string): void;
  /** Calls to a method wait from now until the returned function is called. */
  hold(method: Method): () => void;
  /** The next call to a method rejects with this reason. */
  failNext(method: Method, reason: string): void;
  /** A silent peer finally answers everyone waiting on it. */
  speak(username: string): void;
  count(method: Method): number;
}

/** What the daemon's API and the steps' hooks both touch. */
interface Internals {
  readonly gates: Map<Method, Promise<void>>;
  readonly failures: Map<Method, string>;
  readonly waiting: Map<string, Array<() => void>>;
}

type Hooks = Pick<MemorySoulseekClient, 'deliver' | 'finishSearch' | 'transferOf' | 'advance' | 'lose' | 'hold' | 'failNext' | 'speak' | 'count'>;

function hooksOver(client: Omit<MemorySoulseekClient, keyof Hooks>, { gates, failures, waiting }: Internals): Hooks {
  const running = (text: string): MemorySearch[] => [...client.searches.values()].filter((search) => search.text === text && !search.complete);
  const transferOf = (path: string): SoulseekClientTransfer => {
    const found = [...client.transfers.values()].reverse().find((transfer) => transfer.path === path);
    if (!found) throw new Error(`the daemon holds no transfer of ${path}`);
    return found;
  };
  return {
    deliver(text, files) {
      for (const search of running(text)) search.files.push(...files.filter((file) => search.username === undefined || search.username === file.username));
    },
    finishSearch(text) {
      for (const search of running(text)) search.complete = true;
    },
    transferOf,
    advance(path, change) {
      const found = transferOf(path);
      client.transfers.set(found.id, { ...found, ...change });
    },
    lose(path) {
      client.transfers.delete(transferOf(path).id);
    },
    hold(method) {
      let open: () => void = () => undefined;
      gates.set(method, new Promise<void>((resolve) => {
        open = resolve;
      }));
      return () => {
        gates.delete(method);
        open();
      };
    },
    failNext(method, reason) {
      failures.set(method, reason);
    },
    speak(username) {
      for (const resolve of waiting.get(username) ?? []) resolve();
      waiting.delete(username);
    },
    count(method) {
      return client.calls.filter((call) => call.method === method).length;
    },
  };
}

/** Builds the in-memory daemon. */
export function createMemorySoulseekClient(): MemorySoulseekClient {
  const internals: Internals = { gates: new Map(), failures: new Map(), waiting: new Map() };
  let serial = 0;
  const enter = async (method: Method, args: readonly unknown[]): Promise<void> => {
    client.calls.push({ method, args });
    await internals.gates.get(method);
    if (!client.reachable) throw new Error('unavailable:unreachable no answer');
    if (client.refusesSignIn) throw new Error('denied:credentials the key was refused');
    const reason = internals.failures.get(method);
    internals.failures.delete(method);
    if (reason) throw new Error(reason);
  };
  const known = (id: string): MemorySearch => {
    const search = client.searches.get(id);
    if (!search) throw new Error('unavailable:not-found no such search');
    return search;
  };
  const client: Omit<MemorySoulseekClient, keyof Hooks> = {
    signedIn: true,
    reachable: true,
    refusesSignIn: false,
    revives: false,
    calls: [],
    searches: new Map(),
    transfers: new Map(),
    peers: new Map(),
    async probe() {
      await enter('probe', []);
      return { version: '0.22.5' };
    },
    async state() {
      await enter('state', []);
      return client.signedIn ? 'online' : 'offline';
    },
    async startSearch(text, options) {
      await enter('startSearch', [text, options]);
      const id = `search-${++serial}`;
      client.searches.set(id, { text, ...(options.username === undefined ? {} : { username: options.username }), files: [], complete: false });
      return { id };
    },
    async searchResults(id) {
      await enter('searchResults', [id]);
      const search = known(id);
      return { complete: search.complete, files: [...search.files] };
    },
    async stopSearch(id) {
      await enter('stopSearch', [id]);
      known(id).complete = true;
    },
    async deleteSearch(id) {
      await enter('deleteSearch', [id]);
      known(id);
      client.searches.delete(id);
    },
    async browse(username) {
      await enter('browse', [username]);
      const peer = client.peers.get(username);
      if (!peer || peer.mood === 'offline') throw new Error('unavailable:peer-unavailable the peer is not there');
      if (peer.mood === 'refusing') throw new Error('denied:peer the peer refused');
      if (peer.mood === 'silent') {
        await new Promise<void>((resolve) => {
          internals.waiting.set(username, [...(internals.waiting.get(username) ?? []), resolve]);
        });
      }
      return [...peer.files];
    },
    async download(file) {
      await enter('download', [file]);
      const stopped = [...client.transfers.values()].find((transfer) => client.revives && transfer.state === 'cancelled' && transfer.username === file.username && transfer.path === file.path);
      if (stopped) {
        client.transfers.set(stopped.id, { ...stopped, state: 'queued' });
        return { id: stopped.id };
      }
      const id = `transfer-${++serial}`;
      client.transfers.set(id, { id, username: file.username, path: file.path, size: file.size, state: 'queued', received: '0' });
      return { id };
    },
    async transfer(username, id) {
      await enter('transfer', [username, id]);
      const found = client.transfers.get(id);
      return found && found.username === username ? { ...found } : undefined;
    },
    async cancel(username, id, remove) {
      await enter('cancel', [username, id, remove]);
      const found = client.transfers.get(id);
      if (!found || found.username !== username) throw new Error('unavailable:not-found no such transfer');
      if (found.state === 'queued' || found.state === 'transferring') client.transfers.set(id, { ...found, state: 'cancelled' });
      if (remove) client.transfers.delete(id);
    },
  };
  return Object.assign(client, hooksOver(client, internals));
}
