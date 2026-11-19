import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { RelayPool } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';
import { getPublicKey, verifyEvent } from 'applesauce-core/helpers';
import type { ServiceHandler, ServiceRuntimeContext } from '@kehto/runtime';
import type { NappletMessage, NostrEvent } from '@napplet/core';
import { createRemoteToolsService, createWindowIdentities, type WindowIdentities } from '@kernlize/core';
import { startLoopbackRelay, type LoopbackRelay } from './loopback-relay.js';
import { scratch, type CoreWorld } from './world.js';

const KIND_TOOL_MESSAGE = 25910;
const KIND_SEALED = 21059;

interface ToolMessage {
  readonly jsonrpc: '2.0';
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: { readonly content?: ReadonlyArray<{ readonly text?: string }> };
}

interface ToolServer {
  readonly pubkey: string;
  readonly callers: Set<string>;
  push(relay: LoopbackRelay, caller: string, message: ToolMessage): Promise<void>;
}

interface RemoteTools {
  relays: LoopbackRelay[];
  pool: RelayPool;
  server?: ToolServer;
  identities: WindowIdentities;
  service?: ServiceHandler;
  received: Map<string, NappletMessage[]>;
  keys: Map<string, Uint8Array>;
}

function remote(world: CoreWorld): RemoteTools {
  return (scratch(world).remoteTools ??= {
    relays: [],
    pool: new RelayPool(),
    identities: createWindowIdentities(),
    received: new Map(),
    keys: new Map(),
  }) as RemoteTools;
}

After(async (world: CoreWorld) => {
  const state = scratch(world).remoteTools as RemoteTools | undefined;
  if (!state) return;
  state.service?.onUnregistered?.();
  state.pool.close();
  for (const relay of state.relays) await relay.close();
});

const now = (): number => Math.floor(Date.now() / 1000);

/** Seal a tool message for one reader the way the wire does: signed inside, encrypted to the reader, wrapped by a throwaway key. */
async function seal(from: PrivateKeySigner, to: string, message: ToolMessage): Promise<NostrEvent> {
  const inner = await from.signEvent({ kind: KIND_TOOL_MESSAGE, created_at: now(), tags: [['p', to]], content: JSON.stringify(message) });
  const wrapper = new PrivateKeySigner();
  return wrapper.signEvent({ kind: KIND_SEALED, created_at: now(), tags: [['p', to]], content: await wrapper.nip44.encrypt(to, JSON.stringify(inner)) });
}

function answerFor(request: ToolMessage, tool: string, answer: string): ToolMessage {
  if (request.method === 'initialize') {
    return { jsonrpc: '2.0', id: request.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} } } as ToolMessage['result'] };
  }
  if (request.method === 'tools/call' && request.params?.name === tool) {
    return { jsonrpc: '2.0', id: request.id, result: { content: [{ text: answer }] } };
  }
  return { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'method not found' } } as ToolMessage;
}

async function listen(server: PrivateKeySigner, relay: LoopbackRelay, callers: Set<string>, tool: string, answer: string): Promise<void> {
  const pubkey = await server.getPublicKey();
  relay.onPublish(async (wrap) => {
    if (wrap.kind !== KIND_SEALED || !wrap.tags.some((tag) => tag[0] === 'p' && tag[1] === pubkey)) return;
    const inner = JSON.parse(await server.nip44.decrypt(wrap.pubkey, wrap.content)) as NostrEvent;
    if (!verifyEvent(inner) || inner.kind !== KIND_TOOL_MESSAGE) return;
    callers.add(inner.pubkey);
    const request = JSON.parse(inner.content) as ToolMessage;
    if (request.id !== undefined) relay.store(await seal(server, inner.pubkey, answerFor(request, tool, answer)));
  });
}

Given('a loopback relay', async (world: CoreWorld) => {
  remote(world).relays.push(await startLoopbackRelay());
});

Given('a tool server {string} on the loopback relay whose {string} tool answers {string}', async (world: CoreWorld, name: string, tool: string, answer: string) => {
  const state = remote(world);
  const signer = new PrivateKeySigner();
  const relay = state.relays[0] as LoopbackRelay;
  relay.store(await signer.signEvent({ kind: 11316, created_at: now(), tags: [['name', name], ['about', 'Trust scores']], content: '{}' }));
  relay.store(await signer.signEvent({ kind: 11317, created_at: now(), tags: [['i', '0'.repeat(64), tool]], content: '{}' }));
  const callers = new Set<string>();
  await listen(signer, relay, callers, tool, answer);
  state.server = {
    pubkey: await signer.getPublicKey(),
    callers,
    push: async (target, caller, message) => target.store(await seal(signer, caller, message)),
  };
  scratch(world).toolServerSigner = { signer, tool, answer };
});

Given('a second loopback relay where the tool server also listens', async (world: CoreWorld) => {
  const state = remote(world);
  const relay = await startLoopbackRelay();
  state.relays.push(relay);
  const { signer, tool, answer } = scratch(world).toolServerSigner as { signer: PrivateKeySigner; tool: string; answer: string };
  await listen(signer, relay, (state.server as ToolServer).callers, tool, answer);
});

function startService(world: CoreWorld, relays: () => readonly string[]): void {
  const state = remote(world);
  state.service = createRemoteToolsService({ pool: state.pool, relays, identities: state.identities });
  // A runtime without kehto's approval authority, as kernl registers it today.
  state.service.onRegistered?.({} as ServiceRuntimeContext);
}

Given('the remote tools service looks on the loopback relay', (world: CoreWorld) => {
  startService(world, () => [(remote(world).relays[0] as LoopbackRelay).url]);
});

Given('the remote tools service looks on no relays', (world: CoreWorld) => {
  startService(world, () => []);
});

/** Send one message as a window and wait for the reply of `type`. */
function ask(world: CoreWorld, windowId: string, message: NappletMessage, type: string): Promise<NappletMessage> {
  const state = remote(world);
  const received = state.received.get(windowId) ?? [];
  state.received.set(windowId, received);
  return new Promise((resolve) => {
    (state.service as ServiceHandler).handleMessage(windowId, message, (reply) => {
      received.push(reply);
      if (reply.type === type) resolve(reply);
    });
  });
}

When('window {string} looks for remote tools', async (world: CoreWorld, windowId: string) => {
  scratch(world).found = await ask(world, windowId, { type: 'cvm.discover', id: 'd1' } as NappletMessage, 'cvm.discover.result');
});

Then('window {string} finds {string} offering {string}', (_world: CoreWorld, _windowId: string, name: string, tool: string) => {
  const found = scratch(_world).found as { servers: Array<{ name?: string; capabilities?: string[] }> };
  expect(found.servers).toEqual([expect.objectContaining({ name, capabilities: [tool] })]);
});

async function call(world: CoreWorld, windowId: string, relays?: readonly string[]): Promise<void> {
  const state = remote(world);
  const server = { pubkey: (state.server as ToolServer).pubkey, ...(relays ? { relays: [...relays] } : {}) };
  const message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trust_score', arguments: {} } };
  const reply = await ask(world, windowId, { type: 'cvm.request', id: `r-${windowId}`, server, message, options: { initialize: true } } as NappletMessage, 'cvm.request.result');
  scratch(world).answer = reply;
  state.keys.set(windowId, state.identities.signer(windowId).key);
}

When('window {string} calls {string} on the tool server', async (world: CoreWorld, windowId: string) => {
  await call(world, windowId);
});

When('window {string} calls {string} on the tool server at the second relay', async (world: CoreWorld, windowId: string) => {
  await call(world, windowId, [(remote(world).relays[1] as LoopbackRelay).url]);
});

Then('window {string} gets the answer {string}', (world: CoreWorld, _windowId: string, answer: string) => {
  const reply = scratch(world).answer as { message?: ToolMessage; error?: string };
  expect(reply.error).toBeUndefined();
  expect(reply.message?.result?.content?.[0]?.text).toBe(answer);
});

Then('every request reached the server sealed for it alone', (world: CoreWorld) => {
  const state = remote(world);
  const requests = (state.relays[0] as LoopbackRelay).published.filter((event) => event.tags.some((tag) => tag[0] === 'p' && tag[1] === state.server?.pubkey));
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.kind).toBe(KIND_SEALED);
    expect(request.content).not.toContain('tools/call');
  }
});

Then('the tool server saw {int} different callers', (world: CoreWorld, count: number) => {
  expect(remote(world).server?.callers.size).toBe(count);
});

When('the tool server pushes a notice to the caller of window {string}', async (world: CoreWorld, windowId: string) => {
  const state = remote(world);
  const caller = getPublicKey(state.keys.get(windowId) as Uint8Array);
  await (state.server as ToolServer).push(state.relays[0] as LoopbackRelay, caller, { jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'scores updated' } });
  await new Promise((resolve) => setTimeout(resolve, 300));
});

const notices = (world: CoreWorld, windowId: string): NappletMessage[] => (remote(world).received.get(windowId) ?? []).filter((message) => message.type === 'cvm.event');

Then('window {string} receives the notice', (world: CoreWorld, windowId: string) => {
  expect(notices(world, windowId)).toEqual([expect.objectContaining({ message: expect.objectContaining({ method: 'notifications/message' }) })]);
});

Then('window {string} receives no notice', (world: CoreWorld, windowId: string) => {
  expect(notices(world, windowId)).toEqual([]);
});

When('window {string} closes', (world: CoreWorld, windowId: string) => {
  remote(world).service?.onWindowDestroyed?.(windowId);
});

When('the remote tools service is unregistered', (world: CoreWorld) => {
  const state = remote(world);
  state.service?.onUnregistered?.();
  delete state.service;
});

Then('the key window {string} called under is all zeros', (world: CoreWorld, windowId: string) => {
  expect([...(remote(world).keys.get(windowId) as Uint8Array)].every((byte) => byte === 0)).toBe(true);
});
