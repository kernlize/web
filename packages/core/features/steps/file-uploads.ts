import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { Subject, type Observable } from 'rxjs';
import { EventStore } from 'applesauce-core';
import { PrivateKeySigner } from 'applesauce-signers';
import type { BlobDescriptor } from 'blossom-client-sdk';
import type { UploadResult, UploadStatus } from '@kehto/services';
import type { NostrEvent } from '@napplet/core';
import {
  askUploadConsent,
  createAccountFileServers,
  createBlossomUploader,
  DEFAULT_FILE_SERVERS,
  fileServersFromEvent,
  fileServerTags,
  sizeWords,
  type AccountFileServers,
  type ConsentPrompt,
  type MultiServerUpload,
  type PublishOutcome,
  type UploadDetails,
} from '@kernlize/core';
import { attempt, scratch, splitList, type CoreWorld } from './world.js';

interface UploadScratch {
  files?: AccountFileServers;
  feed?: Subject<NostrEvent>;
  store?: EventStore;
  signer?: PrivateKeySigner;
  refusing: Set<string>;
  refuseAll: boolean;
  publishBreaks: boolean;
  saved?: PublishOutcome;
  servers: string[];
  allow: boolean;
  noSigner: boolean;
  asked: UploadDetails[];
  signed: number;
  sent: number;
  storing: Set<string> | 'all';
  breaks: boolean;
  result?: UploadResult;
}

const u = (world: CoreWorld): UploadScratch => {
  const state = scratch(world);
  state.uploads ??= { refusing: new Set(), refuseAll: false, publishBreaks: false, servers: [], allow: true, noSigner: false, asked: [], signed: 0, sent: 0, storing: 'all', breaks: false } satisfies UploadScratch;
  return state.uploads as UploadScratch;
};

const IDENTITY = { dTag: 'gallery', hash: 'ab'.repeat(32) };

async function fileServers(world: CoreWorld, signedIn: boolean): Promise<void> {
  const state = u(world);
  const store = new EventStore();
  const signer = new PrivateKeySigner();
  const feed = new Subject<NostrEvent>();
  const pubkey = await signer.getPublicKey();
  state.store = store;
  state.signer = signer;
  state.feed = feed;
  const pubkey$ = new Subject<string | undefined>();
  state.files = createAccountFileServers({
    store,
    pool: {
      publish: async (relays) => {
        if (state.publishBreaks) throw new Error('network down');
        return (relays as string[]).map((from) => ({ from, ok: !state.refuseAll && !state.refusing.has(from), message: 'blocked' }));
      },
    } as never,
    load: () => feed as Observable<NostrEvent>,
    pubkey$,
    pubkey: () => (signedIn ? pubkey : undefined),
    lookupRelays: () => ['wss://lookup.test'],
    outboxes: () => ['wss://out.test', 'wss://out2.test'],
    signer: () => (signedIn ? signer : undefined),
  });
  pubkey$.next(signedIn ? pubkey : undefined);
}

Then('the file servers of a list naming {string} are {string}', (_world: CoreWorld, named: string, expected: string) => {
  const event = { kind: 10063, tags: splitList(named).map((url) => ['server', url]) } as NostrEvent;
  expect(fileServersFromEvent(event)).toEqual(splitList(expected));
});

Then('a list with no event names no file servers', () => {
  expect(fileServersFromEvent(undefined)).toEqual([]);
});

Then('new file-server tags for {string} over a list with a {string} tag are {string}', (_world: CoreWorld, servers: string, tag: string, expected: string) => {
  const previous = { tags: [['server', 'wss-free.test'], [tag, 'kernl']] } as NostrEvent;
  expect(fileServerTags(splitList(servers), previous).map((entry) => entry.join(' '))).toEqual(expected.split('|'));
});

Then('new file-server tags for {string} are refused with {string}', (_world: CoreWorld, servers: string, reason: string) => {
  expect(() => fileServerTags(splitList(servers))).toThrow(reason);
});

Given('a file-server service for a signed-in account', (world: CoreWorld) => fileServers(world, true));
Given('a file-server service with nobody signed in', (world: CoreWorld) => fileServers(world, false));

When('the file-server lookup answers with nothing', (world: CoreWorld) => {
  u(world).feed?.complete();
});

When("the account's list naming {string} arrives", async (world: CoreWorld, servers: string) => {
  const state = u(world);
  const event = await state.signer?.signEvent({ kind: 10063, created_at: 1_700_000_000, tags: splitList(servers).map((url) => ['server', url]), content: '' });
  state.store?.add(event as NostrEvent);
});

Then('the file servers are {string}', (world: CoreWorld, status: string) => {
  expect(u(world).files?.state().status).toBe(status);
});

Then('the file servers are {string} using the defaults', (world: CoreWorld, status: string) => {
  expect(u(world).files?.state()).toEqual({ status, servers: DEFAULT_FILE_SERVERS });
});

Then('the file servers are {string} using {string}', (world: CoreWorld, status: string, servers: string) => {
  expect(u(world).files?.state()).toMatchObject({ status, servers: splitList(servers) });
});

Then('the servers an upload uses are the defaults', async (world: CoreWorld) => {
  expect(await u(world).files?.current()).toEqual(DEFAULT_FILE_SERVERS);
});

Then('the servers an upload uses are {string}', async (world: CoreWorld, servers: string) => {
  expect(await u(world).files?.current()).toEqual(splitList(servers));
});

Given('{string} refuses the file-server list', (world: CoreWorld, relay: string) => {
  u(world).refusing.add(relay);
});

Given('every server refuses the file-server list', (world: CoreWorld) => {
  u(world).refuseAll = true;
});

Given('publishing fails outright', (world: CoreWorld) => {
  u(world).publishBreaks = true;
});

When('the account saves file servers {string}', async (world: CoreWorld, servers: string) => {
  await attempt(world, async () => {
    u(world).saved = await u(world).files?.save(splitList(servers));
  });
});

Then('the file-server save was accepted by {string} and refused by {string}', (world: CoreWorld, accepted: string, refused: string) => {
  expect(u(world).saved).toMatchObject({ ok: true, accepted: splitList(accepted) });
  expect(u(world).saved?.refused.map((entry) => entry.url)).toEqual(splitList(refused));
});

Then('the file-server save was accepted by nobody', (world: CoreWorld) => {
  expect(u(world).saved).toMatchObject({ ok: false, accepted: [] });
});

function transfer(world: CoreWorld): MultiServerUpload {
  return async (servers, blob, options) => {
    const state = u(world);
    if (state.breaks) throw new Error('network down');
    const stored = new Map<string, BlobDescriptor>();
    for (const server of servers) {
      await options.onAuth(server, 'cd'.repeat(32), 'upload');
      state.sent += 1;
      if (state.storing !== 'all' && !state.storing.has(server)) {
        options.onError(server, 'cd'.repeat(32), blob, new Error('rejected'));
        continue;
      }
      stored.set(server, { url: `${server}${'cd'.repeat(32)}`, sha256: 'cd'.repeat(32), size: blob.size, uploaded: 1, ...(server.includes('two') ? {} : { type: blob.type || undefined }) } as BlobDescriptor);
      options.onUpload(server);
    }
    return stored;
  };
}

Given('an uploader over {string} where the person says {string}', (world: CoreWorld, servers: string, answer: string) => {
  const state = u(world);
  state.servers = splitList(servers);
  state.allow = answer === 'yes';
  state.noSigner = false;
  state.signer = new PrivateKeySigner();
});

Given('{string} refuses the file', (world: CoreWorld, server: string) => {
  u(world).storing = new Set(u(world).servers.filter((entry) => entry !== server));
});

Given('every file server refuses the file', (world: CoreWorld) => {
  u(world).storing = new Set();
});

Given('the transfer breaks', (world: CoreWorld) => {
  u(world).breaks = true;
});

Given('the uploader has no signer', (world: CoreWorld) => {
  u(world).noSigner = true;
});

async function upload(world: CoreWorld, data: Blob | ArrayBuffer, extra: { mimeType?: string; filename?: string } = {}): Promise<void> {
  const state = u(world);
  const signer = state.signer as PrivateKeySigner;
  const uploader = createBlossomUploader({
    servers: async () => state.servers,
    signer: () => (state.noSigner ? undefined : { signEvent: (draft) => ((state.signed += 1), signer.signEvent(draft)) }),
    ask: async (_windowId, details) => (state.asked.push(details), state.allow),
    transfer: transfer(world),
  });
  const statuses: UploadStatus[] = [];
  state.result = await uploader.upload({ data, ...extra }, { uploadId: 'u1', windowId: 'w1', onStatus: (status) => statuses.push(status) });
}

When('an applet uploads a {int}-byte {string} file named {string}', (world: CoreWorld, size: number, type: string, filename: string) =>
  upload(world, new Blob([new Uint8Array(size)], { type }), { filename }),
);

When('an applet uploads a {int}-byte {string} file', (world: CoreWorld, size: number, type: string) => upload(world, new Blob([new Uint8Array(size)], { type })));

When('an applet uploads {int} raw bytes without a type', (world: CoreWorld, size: number) => upload(world, new Uint8Array(size).buffer));

Then('the upload was {string} with {string}', (world: CoreWorld, status: string, error: string) => {
  expect(u(world).result).toMatchObject({ ok: false, status, error, rail: 'blossom' });
});

Then('the person was asked about {string}, {string} going to {string}', (world: CoreWorld, file: string, size: string, hosts: string) => {
  const details = u(world).asked.at(-1) as UploadDetails;
  const summary = askedSummary(details);
  expect(summary.lines.map((line) => line.after)).toEqual([file, size, hosts, 'Anyone who has its address']);
});

function askedSummary(details: UploadDetails) {
  let presented: ConsentPrompt | undefined;
  void askUploadConsent({ presentConsent: (prompt) => void (presented = prompt) }, IDENTITY, details);
  return (presented as ConsentPrompt).summary;
}

Then('nothing was signed or sent', (world: CoreWorld) => {
  expect(u(world).signed).toBe(0);
  expect(u(world).sent).toBe(0);
});

Then('the upload is complete at {string} with a copy at {string}', (world: CoreWorld, first: string, copy: string) => {
  expect(u(world).result).toMatchObject({ ok: true, status: 'complete', url: `${first}${'cd'.repeat(32)}`, fallbackUrls: [`${copy}${'cd'.repeat(32)}`], sha256: 'cd'.repeat(32), size: 10, mimeType: 'text/plain' });
});

Then('the upload is complete at {string} with no copies', (world: CoreWorld, first: string) => {
  expect(u(world).result).toMatchObject({ ok: true, url: `${first}${'cd'.repeat(32)}`, mimeType: 'text/plain' });
  expect(u(world).result?.fallbackUrls).toBeUndefined();
});

Then('the authorization was signed {int} times', (world: CoreWorld, count: number) => {
  expect(u(world).signed).toBe(count);
});

Then("the upload's file tags carry its address, hash, type and size", (world: CoreWorld) => {
  const tags = u(world).result?.nip94 ?? [];
  expect(tags.map((tag) => tag[0])).toEqual(['url', 'x', 'm', 'size', 'fallback']);
  expect(tags.find((tag) => tag[0] === 'size')?.[1]).toBe('10');
});

Then('{int} bytes read {string}', (_world: CoreWorld, bytes: number, words: string) => {
  expect(sizeWords(bytes)).toBe(words);
});

Then('asking the host about an upload from a known applet presents {string} marked {string}', async (_world: CoreWorld, title: string, severity: string) => {
  const details: UploadDetails = { mimeType: 'image/png', size: 1, sha256: 'cd'.repeat(32), servers: ['https://one.test/'] };
  let presented: ConsentPrompt | undefined;
  const answer = askUploadConsent({ presentConsent: (prompt) => void (presented = prompt) }, IDENTITY, details);
  expect(presented?.summary).toMatchObject({ title, severity, applet: IDENTITY, event: { kind: 24242, tags: [['t', 'upload'], ['x', 'cd'.repeat(32)]] } });
  presented?.resolve(true);
  expect(await answer).toBe(true);
});

Then('asking the host about an upload from an unknown applet answers no without asking', async () => {
  let asked = false;
  const details: UploadDetails = { mimeType: 'image/png', size: 1, sha256: 'cd'.repeat(32), servers: [] };
  expect(await askUploadConsent({ presentConsent: () => void (asked = true) }, undefined, details)).toBe(false);
  expect(asked).toBe(false);
});

When('an upload asks for its servers while the list is being looked up', (world: CoreWorld) => {
  scratch(world).askedServers = u(world).files?.current();
});

Then('the servers it was given are the defaults', async (world: CoreWorld) => {
  expect(await (scratch(world).askedServers as Promise<readonly string[]>)).toEqual(DEFAULT_FILE_SERVERS);
});

When('the file-server lookup fails', (world: CoreWorld) => {
  u(world).feed?.error(new Error('relays down'));
});
