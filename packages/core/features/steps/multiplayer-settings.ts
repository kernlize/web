import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { RelayPool } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';
import { neventEncode, verifyEvent } from 'applesauce-core/helpers';
import type { ServiceHandler, ServiceRuntimeContext } from '@kehto/runtime';
import { computeCvmToolSchemaHash, type CvmRegistryFamily } from '@kehto/services';
import type { NappletMessage, NostrEvent } from '@napplet/core';
import {
  createKernl,
  createMultiplayerSettings,
  createRemoteToolsService,
  createWindowIdentities,
  discoverToolFamilies,
  mergeFamilies,
  type Kernl,
  type MultiplayerSettings,
  type ToolFamilyCandidate,
} from '@kernlize/core';
import { startLoopbackRelay, type LoopbackRelay } from './loopback-relay.js';
import { MemoryStorage, scratch, splitList, type CoreWorld } from './world.js';

const INPUT = { type: 'object', properties: { subject: { type: 'string' } } };
const OUTPUT = { type: 'object', properties: { score: { type: 'number' } } };
const REQUESTS_ELSEWHERE = 'wss://reads.example';

interface Tools {
  relay?: LoopbackRelay;
  pool: RelayPool;
  server?: PrivateKeySigner;
  serverKey?: string;
  serverAnnouncement?: NostrEvent;
  toolList?: NostrEvent;
  note?: NostrEvent;
  statedHash?: string;
  storage: MemoryStorage;
  settings?: MultiplayerSettings;
  website?: Server;
  websiteUrl?: string;
  found?: ToolFamilyCandidate[];
  refused?: string;
  service?: ServiceHandler;
  answer?: Record<string, unknown>;
  kernl?: Kernl;
}

function tools(world: CoreWorld): Tools {
  return (scratch(world).multiplayer ??= { pool: new RelayPool(), storage: new MemoryStorage() }) as Tools;
}

After(async (world: CoreWorld) => {
  const state = scratch(world).multiplayer as Tools | undefined;
  if (!state) return;
  state.service?.onUnregistered?.();
  state.kernl?.destroy();
  state.pool.close();
  await state.relay?.close();
  state.website?.closeAllConnections();
  state.website?.close();
});

const now = (): number => Math.floor(Date.now() / 1000);
const hashOf = (name: string, output?: Record<string, unknown>): Promise<string> => computeCvmToolSchemaHash({ name, inputSchema: INPUT, ...(output ? { outputSchema: output } : {}) });

/** Answer sealed tool requests the way a tool server does: initialize, tools/list and tools/call. */
function answerRequests(relay: LoopbackRelay, server: PrivateKeySigner, listed: () => unknown[]): void {
  relay.onPublish(async (wrap) => {
    const pubkey = await server.getPublicKey();
    if (wrap.kind !== 21059 || !wrap.tags.some((tag) => tag[0] === 'p' && tag[1] === pubkey)) return;
    const inner = JSON.parse(await server.nip44.decrypt(wrap.pubkey, wrap.content)) as NostrEvent;
    if (!verifyEvent(inner)) return;
    const request = JSON.parse(inner.content) as { id?: number; method?: string };
    if (request.id === undefined) return;
    const result = request.method === 'tools/list' ? { tools: listed() }
      : request.method === 'tools/call' ? { content: [{ type: 'text', text: '0.87' }] }
        : { protocolVersion: '2025-11-25', capabilities: { tools: {} } };
    const reply = await server.signEvent({ kind: 25910, created_at: now(), tags: [['p', inner.pubkey]], content: JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) });
    const wrapper = new PrivateKeySigner();
    relay.store(await wrapper.signEvent({ kind: 21059, created_at: now(), tags: [['p', inner.pubkey]], content: await wrapper.nip44.encrypt(inner.pubkey, JSON.stringify(reply)) }));
  });
}

async function announce(world: CoreWorld, list: { tools: unknown; tags: string[][]; createdAt?: number }, relayList = true): Promise<void> {
  const state = tools(world);
  state.relay ??= await startLoopbackRelay();
  state.server ??= new PrivateKeySigner();
  state.serverKey = await state.server.getPublicKey();
  const relay = state.relay;
  state.serverAnnouncement = await state.server.signEvent({ kind: 11316, created_at: now() - 100, tags: [['name', 'Trust fixture']], content: '{}' });
  relay.store(state.serverAnnouncement);
  state.toolList = await state.server.signEvent({ kind: 11317, created_at: list.createdAt ?? now(), tags: list.tags, content: typeof list.tools === 'string' ? list.tools : JSON.stringify({ tools: list.tools }) });
  relay.store(state.toolList);
  if (relayList) relay.store(await state.server.signEvent({ kind: 10002, created_at: now(), tags: [['r', relay.url], ['r', REQUESTS_ELSEWHERE, 'read']], content: '' }));
  const listed = Array.isArray(list.tools) ? list.tools : [];
  answerRequests(relay, state.server, () => listed);
}

const trustScore = (output?: Record<string, unknown>) => ({ name: 'trust_score', inputSchema: INPUT, ...(output ? { outputSchema: output } : {}) });

Given('a loopback relay with a tool server that announces {string} and says where it takes requests', async (world: CoreWorld, name: string) => {
  await announce(world, { tools: [trustScore()], tags: [['i', await hashOf(name), name]] });
});

Given('a loopback relay with a tool server that announced {string}, then {string} with an output schema', async (world: CoreWorld, old: string, name: string) => {
  const hash = await hashOf(name, OUTPUT);
  const state = tools(world);
  state.relay = await startLoopbackRelay();
  state.server = new PrivateKeySigner();
  state.relay.store(await state.server.signEvent({ kind: 11317, created_at: now() - 50, tags: [['i', hash, old]], content: JSON.stringify({ tools: [{ name: old, inputSchema: INPUT }] }) }));
  await announce(world, { tools: [trustScore(OUTPUT)], tags: [['i', hash, name]] }, false);
});

Given('a loopback relay with a tool server whose stated schema hash is not its tool\'s', async (world: CoreWorld) => {
  tools(world).statedHash = 'ab'.repeat(32);
  await announce(world, { tools: [trustScore()], tags: [['i', 'ab'.repeat(32), 'trust_score']] });
});

Given('a loopback relay with a tool server whose tool list is not a list', async (world: CoreWorld) => {
  await announce(world, { tools: 'not a list', tags: [] });
});

Given('a loopback relay with a tool server that lists the same tool twice', async (world: CoreWorld) => {
  await announce(world, { tools: [trustScore(), trustScore()], tags: [] });
});

Given('a loopback relay with a tool server whose list leaves out the hash it is found by', async (world: CoreWorld) => {
  tools(world).statedHash = await hashOf('ghost');
  await announce(world, { tools: [trustScore()], tags: [['i', await hashOf('ghost'), 'ghost']] });
});

Given('the person\'s settings on this device', (world: CoreWorld) => {
  tools(world).settings = createMultiplayerSettings(tools(world).storage);
});

const settings = (world: CoreWorld): MultiplayerSettings => tools(world).settings as MultiplayerSettings;

When('the person chooses the servers {string}', (world: CoreWorld, urls: string) => {
  settings(world).setServers(splitList(urls));
});

When('the person chooses the helper {string} as {string} with {string}', (world: CoreWorld, url: string, username: string, credential: string) => {
  settings(world).setHelpers([{ urls: [url], username, credential }]);
});

Then('the settings come back the same after a reload, with each server once', (world: CoreWorld) => {
  const reloaded = createMultiplayerSettings(tools(world).storage).state();
  expect(reloaded.servers).toEqual(['wss://meet.example', 'wss://also.example']);
  expect(reloaded.helpers).toEqual([{ urls: ['turn:turn.example:3478'], username: 'ann', credential: 'secret' }]);
  expect(reloaded).toEqual(settings(world).state());
});

When('the person goes back to the host\'s servers and helpers', (world: CoreWorld) => {
  settings(world).setServers(undefined);
  settings(world).setHelpers(undefined);
});

Then('the settings name no servers and no helpers', (world: CoreWorld) => {
  const state = settings(world).state();
  expect(state.servers).toBeUndefined();
  expect(state.helpers).toBeUndefined();
});

const KEY = 'cd'.repeat(32);
const family = (label: string, tools_: Array<{ name: string; schemaHash: string }>, pubkey = KEY): CvmRegistryFamily => ({ family: label, server: { pubkey, relays: ['wss://tools.example'] }, tools: tools_ });
const HASH = 'ef'.repeat(32);

const ATTEMPTS: Record<string, (target: MultiplayerSettings) => void> = {
  'choose the servers "https://meet.example"': (target) => target.setServers(['https://meet.example']),
  'choose the helper "https://help.example"': (target) => target.setHelpers([{ urls: ['https://help.example'] }]),
  'trust a family with no tools': (target) => target.saveFamily(family('rooms', [])),
  'trust a family whose tool has no schema hash': (target) => target.saveFamily(family('rooms', [{ name: 'join', schemaHash: 'not-a-hash' }])),
  'trust a family whose provider key is not a key': (target) => target.saveFamily(family('rooms', [{ name: 'join', schemaHash: HASH }], 'not-a-key')),
  'trust a family that names one tool twice': (target) => target.saveFamily(family('rooms', [{ name: 'join', schemaHash: HASH }, { name: 'join', schemaHash: HASH }])),
  'trust a seventeenth family': (target) => {
    for (let index = 0; index < 17; index += 1) target.saveFamily(family(`family-${index}`, [{ name: 'join', schemaHash: HASH }]));
  },
};

When(/^the person tries, in settings, to (.+)$/, (world: CoreWorld, attempt: string) => {
  try {
    (ATTEMPTS[attempt] as (target: MultiplayerSettings) => void)(settings(world));
  } catch (error) {
    tools(world).refused = (error as Error).message;
  }
});

Then('the settings refuse it with {string}', (world: CoreWorld, error: string) => {
  expect(tools(world).refused).toBe(error);
});

When('the person trusts the family {string} with the tool {string}', (world: CoreWorld, label: string, tool: string) => {
  settings(world).saveFamily(family(label, [{ name: tool, schemaHash: HASH }]));
});

Then('the person trusts {int} family, {string} with the tool {string}', (world: CoreWorld, count: number, label: string, tool: string) => {
  expect(settings(world).state().families).toEqual([family(label, [{ name: tool, schemaHash: HASH }])]);
  expect(settings(world).state().families).toHaveLength(count);
});

When('the person stops trusting the family {string}', (world: CoreWorld, label: string) => {
  settings(world).removeFamily(label, KEY);
});

Then('the person trusts {int} families', (world: CoreWorld, count: number) => {
  expect(settings(world).state().families).toHaveLength(count);
});

Given('settings on this device that hold a server that is not one, a broken helper and a broken family', (world: CoreWorld) => {
  const state = tools(world);
  state.storage.setItem('kernl:multiplayer:v1', JSON.stringify({ servers: ['ftp://nope'], helpers: [{ urls: [] }], families: [{ family: '', server: { pubkey: 'x' }, tools: [] }] }));
  state.settings = createMultiplayerSettings(state.storage);
});

function startWebsite(world: CoreWorld, body: string): Promise<void> {
  const state = tools(world);
  return new Promise((resolve) => {
    state.website = createServer((request, response) => {
      response.writeHead(request.url === '/.well-known/napplet.json' ? 200 : 404, { 'content-type': 'application/json' });
      response.end(body);
    });
    state.website.listen(0, '127.0.0.1', () => {
      state.websiteUrl = `http://127.0.0.1:${((state.website as Server).address() as AddressInfo).port}`;
      resolve();
    });
  });
}

/** What the page's fetch would do for `https://tools.example`, served from the loopback website. */
const websiteFetch = (world: CoreWorld): typeof fetch => (async (input: string | URL | Request) => {
  const { websiteUrl } = tools(world);
  if (!websiteUrl) throw new TypeError('Failed to fetch');
  return fetch(`${websiteUrl}${new URL(String(input)).pathname}`);
}) as typeof fetch;

async function search(world: CoreWorld, input: string): Promise<void> {
  const state = tools(world);
  try {
    state.found = await discoverToolFamilies(input, { pool: state.pool, relays: [state.relay?.url ?? ''], fetch: websiteFetch(world), timeoutMs: 3_000 });
  } catch (error) {
    state.refused = (error as Error).message;
  }
}

When('the person looks for tools by the schema hash of {string}', async (world: CoreWorld, name: string) => {
  const output = (tools(world).toolList?.content ?? '').includes('outputSchema') ? OUTPUT : undefined;
  await search(world, await hashOf(name, output));
});

const REFERENCES: Record<string, (world: CoreWorld) => Promise<string>> = {
  "a reference to the server's announcement": async (world) => neventEncode({ id: (tools(world).serverAnnouncement as NostrEvent).id, kind: 11316, author: tools(world).serverKey as string }),
  'a reference to the tool list, naming the relay': async (world) => neventEncode({ id: (tools(world).toolList as NostrEvent).id, relays: [(tools(world).relay as LoopbackRelay).url] }),
  'the website that publishes the tool server': async (world) => {
    await startWebsite(world, JSON.stringify({ version: 1, backend: { pubkey: tools(world).serverKey, relays: [(tools(world).relay as LoopbackRelay).url] } }));
    return 'tools.example';
  },
  'a reference to a note': async (world) => neventEncode({ id: (tools(world).toolList as NostrEvent).id, kind: 1 }),
  'a schema hash nobody has': async () => '12'.repeat(32),
  'the schema hash it states': async (world) => tools(world).statedHash as string,
  'the schema hash it is found by': async (world) => tools(world).statedHash as string,
  'a website that is down': async () => 'https://tools.example',
  'a website whose document is not JSON': async (world) => {
    await startWebsite(world, 'not json');
    return 'https://tools.example';
  },
  'a website whose document is too large': async (world) => {
    await startWebsite(world, 'x'.repeat(1_000_001));
    return 'https://tools.example';
  },
  'a website whose document names no provider': async (world) => {
    await startWebsite(world, JSON.stringify({ version: 1, backend: {} }));
    return 'https://tools.example';
  },
};

When(/^the person looks for tools from (.+)$/, async (world: CoreWorld, reference: string) => {
  const build = REFERENCES[reference];
  await search(world, build ? await build(world) : JSON.parse(reference) as string);
});

Then('the search is refused with {string}', (world: CoreWorld, error: string) => {
  expect(tools(world).found).toBeUndefined();
  expect(tools(world).refused).toBe(error);
});

async function foundOne(world: CoreWorld, name: string): Promise<CvmRegistryFamily> {
  const state = tools(world);
  expect(state.refused).toBeUndefined();
  expect(state.found).toHaveLength(1);
  const candidate = (state.found as ToolFamilyCandidate[])[0] as ToolFamilyCandidate;
  const output = (state.toolList?.content ?? '').includes('outputSchema') ? OUTPUT : undefined;
  expect(candidate.family.server.pubkey).toBe(state.serverKey);
  expect(candidate.family.tools).toEqual([{ name, schemaHash: await hashOf(name, output) }]);
  expect(candidate.eventId).toBe(state.toolList?.id);
  return candidate.family;
}

Then('one family is found, from the tool server, with {string} pinned to its schema hash', async (world: CoreWorld, name: string) => {
  await foundOne(world, name);
});

Then('one family is found, from the tool server, with {string} pinned to its schema hash, taking requests where it said', async (world: CoreWorld, name: string) => {
  expect((await foundOne(world, name)).server.relays).toEqual([tools(world).relay?.url]);
});

Then('one family is found, from the tool server, with {string} pinned to its schema hash, taking requests on the loopback relay', async (world: CoreWorld, name: string) => {
  expect((await foundOne(world, name)).server.relays).toEqual([tools(world).relay?.url]);
});

When('the person trusts it as {string}', (world: CoreWorld, label: string) => {
  const candidate = (tools(world).found as ToolFamilyCandidate[])[0] as ToolFamilyCandidate;
  settings(world).saveFamily({ ...candidate.family, family: label });
});

When('an applet asks the family {string} to run {string}', async (world: CoreWorld, label: string, tool: string) => {
  const state = tools(world);
  state.service = createRemoteToolsService({ pool: state.pool, relays: () => [], identities: createWindowIdentities(), registry: () => settings(world).state().families });
  state.service.onRegistered?.({} as ServiceRuntimeContext);
  state.answer = await new Promise((resolve) => {
    state.service?.handleMessage('w1', { type: 'cvm.registry.call', id: 'call-1', selector: { family: label }, tool, args: {} } as NappletMessage, (reply) => {
      if (reply.type === 'cvm.registry.call.result') resolve(reply as Record<string, unknown>);
    });
  });
});

Then('the applet gets the answer {string}', (world: CoreWorld, answer: string) => {
  const reply = tools(world).answer as { result?: { content?: Array<{ text?: string }> }; error?: string };
  expect(reply.error).toBeUndefined();
  expect(reply.result?.content?.[0]?.text).toBe(answer);
});

Then('with the host\'s families {string} and the person\'s {string} from the same provider, applets are offered {string} from the host and {string} from the person', (_world: CoreWorld, hosts: string, own: string, fromHost: string, fromPerson: string) => {
  const host = splitList(hosts).map((label) => family(label, [{ name: 'host-tool', schemaHash: HASH }]));
  const person = splitList(own).map((label) => family(label, [{ name: 'own-tool', schemaHash: HASH }]));
  const merged = mergeFamilies(host, person);
  expect(merged.map((entry) => [entry.family, entry.tools[0]?.name])).toEqual([[fromHost, 'host-tool'], [fromPerson, 'own-tool']]);
});

Given('a live kernl shell', (world: CoreWorld) => {
  const state = tools(world);
  state.kernl = createKernl({
    host: { storage: state.storage, presentConsent: () => undefined, notify: () => undefined, openLink: () => undefined, getVisibility: () => ({ visible: true, focused: true }), onRevoked: () => undefined },
    relays: { apps: [], super: [], discovery: [], outbox: [] },
    artifactCache: async () => undefined,
  });
});

When('the person chooses the loopback relay as their servers in that shell', (world: CoreWorld) => {
  const state = tools(world);
  state.kernl?.multiplayer.setServers([(state.relay as LoopbackRelay).url]);
});

When('the person looks for tools in that shell by the schema hash of {string}', async (world: CoreWorld, name: string) => {
  const state = tools(world);
  state.found = [...((await state.kernl?.multiplayer.discover(await hashOf(name))) ?? [])];
});

When('the person trusts the family {string}, found on the servers in use', (world: CoreWorld, label: string) => {
  settings(world).saveFamily({ family: label, server: { pubkey: KEY }, tools: [{ name: 'join', schemaHash: HASH }] });
});

Then('a search in that shell, before the person chooses servers, finds no tools', async (world: CoreWorld) => {
  await expect(tools(world).kernl?.multiplayer.discover('12'.repeat(32))).rejects.toThrow('unavailable:no-tools');
});
