import { createRequire } from 'node:module';
import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { blobFetcher, boot, k, settle } from './kernl.js';
import type { CoreWorld } from './world.js';

After(() => {
  delete (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
});

/** A real WebRTC stack for Node, with the browser's API. */
const { RTCPeerConnection: NodePeer } = createRequire(import.meta.url)('@roamhq/wrtc') as { RTCPeerConnection: typeof RTCPeerConnection };

Given('a kernl shell over that host and pool that makes peer connections', (world: CoreWorld) => {
  boot(world, { directConnections: { relays: ['wss://meet.example'], createPeer: (configuration) => new NodePeer(configuration) } }, blobFetcher(world));
});

Given('a page that has its own peer connections', (world: CoreWorld) => {
  k(world).kernl.destroy();
  (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = NodePeer;
});

Then('the shell offers {string}', (world: CoreWorld, domain: string) => {
  expect(k(world).kernl.grants.availableDomains()).toContain(domain);
});

Then('the shell does not offer {string}', (world: CoreWorld, domain: string) => {
  expect(k(world).kernl.grants.availableDomains()).not.toContain(domain);
});

When('the applet asks to open the room {string} over its port', async (world: CoreWorld, room: string) => {
  k(world).channel?.port1.postMessage({ type: 'webrtc.open', id: 'open-1', request: { scope: { type: 'room', room } } });
  await settle();
});

Then('the host was asked {string}', (world: CoreWorld, title: string) => {
  expect(k(world).record.prompts.map((prompt) => prompt.summary.title)).toEqual([title]);
});

Then('the host was not asked anything', (world: CoreWorld) => {
  expect(k(world).record.prompts).toEqual([]);
});

When('the host answers no', async (world: CoreWorld) => {
  k(world).record.prompts[0]?.resolve(false);
  await settle();
});

Then('the applet was told {string} for opening the room', (world: CoreWorld, error: string) => {
  expect(k(world).received.find((entry) => entry.type === 'webrtc.open.result')?.error).toBe(error);
});

Then('the applet got no answer to opening the room', (world: CoreWorld) => {
  expect(k(world).received.map((entry) => entry.type)).not.toContain('webrtc.open.result');
});

Then('the host was asked about a session introduced by {string}', (world: CoreWorld, hosts: string) => {
  expect(k(world).record.prompts[0]?.summary.lines.find((line) => line.label === 'Introduced by')?.after).toBe(hosts);
});
