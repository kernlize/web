import { When } from 'quickpickle';
import { originRegistry } from '@kehto/shell';
import { hello, k, settle } from './kernl.js';
import type { CoreWorld } from './world.js';

/** A window the host put in front of kehto itself, past `kernl.plan`. `admitted` also has kehto's firewall admit it, as another part of the host could. */
async function rogueWindow(world: CoreWorld, rogue: { windowId: string; hash: string; domain: string; admitted: boolean }): Promise<MessageChannel> {
  const win = {} as Window;
  const { windowId, hash, domain } = rogue;
  const identity = { dTag: 'rogue', hash };
  const { kernl } = k(world);
  kernl.grants.allowDomain(identity, domain);
  const permissionPrincipal = { kind: 'verified', manifestKey: `nip5d:35129:${'ab'.repeat(32)}:rogue`, artifactHash: hash } as const;
  if (rogue.admitted) {
    const { runtime } = kernl.bridge;
    runtime.sessionRegistry.register(windowId, { pubkey: '', windowId, origin: 'null', type: 'nip5d', dTag: identity.dTag, aggregateHash: hash, permissionPrincipal, registeredAt: 0, instanceId: windowId, provenance: 'nip-5d' });
    await runtime.permissions?.admit(windowId, { available: [domain, 'storage'], required: [], optional: [domain, 'storage'] });
  }
  originRegistry.register(win, windowId, { dTag: identity.dTag, aggregateHash: hash, ...(rogue.admitted ? { permissionPrincipal } : {}) });
  const channel = hello(world, win);
  k(world).rogue = { windowId, channel };
  return channel;
}

When('a rogue window {word} outside the shell is granted {string}, sends its hello, asks {string} for {string} and floods {string}', async (world: CoreWorld, how: string, domain: string, ask: string, url: string, type: string) => {
  const channel = await rogueWindow(world, { windowId: 'rogue-1', hash: 'cd'.repeat(32), domain, admitted: how === 'admitted' });
  channel.port1.postMessage({ type: ask, id: 'rogue-ask', url });
  await settle();
  for (let i = 0; i < 320; i += 1) channel.port1.postMessage({ type, id: `rogue-${i}`, key: 'k' });
  await settle();
});

When('a rogue window {word} outside the shell is granted {string}, sends its hello and publishes a kind {int} event', async (world: CoreWorld, how: string, domain: string, kind: number) => {
  const channel = await rogueWindow(world, { windowId: 'rogue-publisher', hash: 'ce'.repeat(32), domain, admitted: how === 'admitted' });
  channel.port1.postMessage({ type: 'shell.ready', id: 'ready-1' });
  channel.port1.postMessage({ type: 'relay.publish', id: 'publish-1', event: { kind, content: '{"name":"rogue"}', tags: [], created_at: Math.floor(Date.now() / 1000) } });
  await settle();
});

When('a rogue window {word} outside the shell is granted {string}, sends its hello and uploads a file', async (world: CoreWorld, how: string, domain: string) => {
  const channel = await rogueWindow(world, { windowId: 'rogue-uploader', hash: 'cf'.repeat(32), domain, admitted: how === 'admitted' });
  channel.port1.postMessage({ type: 'shell.ready', id: 'ready-1' });
  channel.port1.postMessage({ type: 'upload.upload', id: 'upload-1', request: { data: new Uint8Array(8).buffer, mimeType: 'text/plain' } });
  await settle();
});
