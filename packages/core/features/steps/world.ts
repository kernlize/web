import { createHash } from 'node:crypto';
import { Observable, of } from 'rxjs';
import { PasswordSigner, PrivateKeySigner } from 'applesauce-signers';
import { PasswordAccount } from 'applesauce-accounts/accounts';
import type { GroupReqMessage, PublishResponse } from 'applesauce-relay';
import type { Filter } from 'applesauce-core/helpers';
import type { NappletArtifactCache, WriteVerifiedResolutionInput } from '@kehto/nip/5d';
import type { NostrEvent, NostrFilter } from '@napplet/core';
import type { ApplesaucePool, FrameLike, SigningConsent, StorageLike } from '@kernlize/core';

/** Map-backed storage satisfying both `StorageLike` and the parts of `Storage` kehto touches. */
export class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

// kehto's shell persists its ACL and manifest cache through `localStorage`; Node has none.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.getItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
}

/** One recorded call to the fake pool. */
export interface PoolCall {
  readonly method: 'req' | 'request' | 'publish';
  readonly relays: readonly string[];
  readonly filters?: readonly NostrFilter[];
  readonly event?: NostrEvent;
}

/** A relay-shaped message the fake pool's `req` emits. */
export type ReqMessage = GroupReqMessage;

/** A fake applesauce pool that replays scripted events and records every call. */
export interface FakePool extends ApplesaucePool {
  readonly calls: PoolCall[];
  /** Events `request` returns and `req` emits as EVENT messages, per relay. */
  events: NostrEvent[];
  /** Extra raw messages `req` emits before the relays settle. */
  extra: ReqMessage[];
  /** When set, `publish` reports this `ok` per relay. */
  publishOk: boolean;
  /** Relays that answer a publish with `OK false`. */
  readonly refusing: Set<string>;
  /** When true, `request` errors instead of completing. */
  failRequests: boolean;
}

export function createFakePool(): FakePool {
  const pool: FakePool = {
    calls: [],
    events: [],
    extra: [],
    publishOk: true,
    refusing: new Set<string>(),
    failRequests: false,
    req(relays, filters) {
      const urls = relays as string[];
      pool.calls.push({ method: 'req', relays: urls, filters: filters as NostrFilter[] });
      return new Observable<ReqMessage>((observer) => {
        for (const url of urls) observer.next({ type: 'OPEN', from: url, id: 'sub', filters: filters as Filter[] });
        for (const url of urls) for (const event of pool.events) observer.next({ type: 'EVENT', from: url, id: 'sub', event });
        for (const message of pool.extra) observer.next(message);
        for (const url of urls) observer.next({ type: 'EOSE', from: url, id: 'sub' });
      });
    },
    request(relays, filters) {
      pool.calls.push({ method: 'request', relays: relays as string[], filters: filters as NostrFilter[] });
      if (pool.failRequests) {
        return new Observable<NostrEvent>((observer) => observer.error(new Error('relay down'))) as ReturnType<ApplesaucePool['request']>;
      }
      return of(...pool.events) as ReturnType<ApplesaucePool['request']>;
    },
    async publish(relays, event) {
      const urls = relays as string[];
      pool.calls.push({ method: 'publish', relays: urls, event: event as NostrEvent });
      if (!pool.publishOk) throw new Error('publish failed');
      return urls.map((from): PublishResponse => (pool.refusing.has(from) ? { ok: false, from, message: 'blocked: not allowed' } : { ok: true, from }));
    },
  };
  return pool;
}

/** A frame with the shape `mountApplet` needs, recording what the shell did to it. */
export interface FakeFrame extends FrameLike {
  readonly attributes: Map<string, string>;
  removed: boolean;
  readonly listeners: Map<string, Array<(event: Event) => void>>;
  fireLoad(): void;
  getAttribute?(name: string): string | null;
}

export function createFakeFrame(options: { detached?: boolean; withGetAttribute?: boolean } = {}): FakeFrame {
  const attributes = new Map<string, string>();
  const listeners = new Map<string, Array<(event: Event) => void>>();
  const win = {} as Window;
  const frame: FakeFrame = {
    contentWindow: options.detached ? null : win,
    srcdoc: '',
    attributes,
    removed: false,
    listeners,
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    remove() {
      frame.removed = true;
    },
    fireLoad() {
      const current = [...(listeners.get('load') ?? [])];
      for (const listener of current) listener({ type: 'load' } as Event);
    },
  };
  if (options.withGetAttribute) frame.getAttribute = (name) => attributes.get(name) ?? null;
  return frame;
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A signing identity for test vectors; the key never leaves the signer. */
export const author = new PrivateKeySigner();

async function unlockPasswordSigner(): Promise<PasswordSigner> {
  const signer = new PasswordSigner();
  signer.key = new PrivateKeySigner().key;
  await signer.setPassword('correct horse');
  return signer;
}

/** One unlocked NIP-49 signer shared by every scenario; deriving it is slow. */
export const passwordSigner = await unlockPasswordSigner();

/** A password account over the shared unlocked signer, labelled by metadata. */
export async function passwordAccount(name: string): Promise<PasswordAccount> {
  const account = new PasswordAccount(await passwordSigner.getPublicKey(), passwordSigner);
  account.metadata = { name };
  return account;
}

export interface ManifestOptions {
  readonly kind?: number;
  readonly dTag?: string;
  readonly html?: string;
  readonly title?: string;
  readonly requires?: readonly string[];
  readonly optional?: readonly string[];
  readonly servers?: readonly string[];
  readonly extraTags?: readonly string[][];
  readonly content?: string;
  readonly createdAt?: number;
}

export interface ManifestVector {
  readonly event: NostrEvent;
  readonly html: string;
  readonly hash: string;
  readonly pubkey: string;
}

/** Build and sign a NIP-5D named manifest (kind 35129) whose `x` tag hashes `html`. */
export async function signManifest(options: ManifestOptions = {}): Promise<ManifestVector> {
  const html = options.html ?? '<!doctype html><html><head><title>Chat</title></head><body>hi</body></html>';
  const hash = sha256Hex(html);
  const kind = options.kind ?? 35129;
  const tags: string[][] = [['x', hash]];
  if (kind === 35129) tags.push(['d', options.dTag ?? 'chat']);
  tags.push(['title', options.title ?? 'Chat']);
  for (const server of options.servers ?? []) tags.push(['server', server]);
  for (const domain of options.requires ?? ['relay']) tags.push(['R', domain]);
  for (const domain of options.optional ?? []) tags.push(['O', domain]);
  tags.push(...(options.extraTags ?? []));
  const event = await author.signEvent({
    kind,
    tags,
    content: options.content ?? 'A chat applet.',
    created_at: options.createdAt ?? 1_700_000_000,
  });
  return { event, html, hash, pubkey: await author.getPublicKey() };
}

/** Sign an arbitrary event with the test author. */
export async function signEvent(template: { kind: number; tags?: string[][]; content?: string; created_at?: number }): Promise<NostrEvent> {
  return author.signEvent({ kind: template.kind, tags: template.tags ?? [], content: template.content ?? '', created_at: template.created_at ?? 1_700_000_000 });
}

/** A fetch that serves blobs by hash from a map. */
export function createBlobFetch(blobs: Map<string, Uint8Array | string>, options: { fail?: boolean; hang?: boolean } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (options.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (options.fail) throw new Error('network down');
    const hash = url.split('/').pop() ?? '';
    const blob = blobs.get(hash);
    if (blob === undefined) return new Response(null, { status: 404 });
    return new Response(typeof blob === 'string' ? new TextEncoder().encode(blob) : blob, { status: 200 });
  }) as typeof fetch;
}

/** A verified-artifact cache that records what the resolver wrote and never serves bytes. */
export interface FakeArtifactCache extends NappletArtifactCache {
  readonly writes: WriteVerifiedResolutionInput[];
}

export function createFakeArtifactCache(): FakeArtifactCache {
  const writes: WriteVerifiedResolutionInput[] = [];
  return {
    writes,
    readBlob: async () => undefined,
    deleteBlob: async () => undefined,
    writeVerifiedResolution: async (input) => void writes.push(input),
    writeCoordinate: async () => undefined,
    getCoordinate: async () => undefined,
    touchAggregate: async () => undefined,
    markAggregateActive: () => undefined,
    releaseAggregateActive: () => undefined,
    prune: async () => undefined,
  };
}

export function last<T>(items: readonly T[]): T {
  const item = items.at(-1);
  if (item === undefined) throw new Error('expected at least one item');
  return item;
}

export function splitList(list: string): string[] {
  return list === '' ? [] : list.split(',').map((part) => part.trim());
}

/** Scenario state shared by every core step file. quickpickle hands each step the same world object. */
export interface CoreScratch {
  storage: MemoryStorage;
  pool: FakePool;
  errors: Error[];
  [key: string]: unknown;
}

export interface CoreWorld {
  core?: CoreScratch;
}

export function scratch(world: CoreWorld): CoreScratch {
  world.core ??= { storage: new MemoryStorage(), pool: createFakePool(), errors: [] };
  return world.core;
}

/** Run a step body and record a thrown error instead of failing the step. */
export async function attempt(world: CoreWorld, body: () => unknown): Promise<void> {
  try {
    await body();
  } catch (error) {
    scratch(world).errors.push(error instanceof Error ? error : new Error(String(error)));
  }
}

/** A consent gate that lets every signature through, for steps that are not about consent. */
export const allowAllSigning: SigningConsent = async () => undefined;
