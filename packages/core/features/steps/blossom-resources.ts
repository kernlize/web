import { createHash } from 'node:crypto';
import { expect, vi } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { createDefaultBridges, resourceErrorFor } from '@kernlize/core';
import type { BridgeContext, BridgeResult } from '@kernlize/bridges';
import { k, settle } from './kernl.js';
import { createFakePool, scratch, signManifest, splitList, type CoreWorld } from './world.js';

const ASSET = new TextEncoder().encode('sprites and sounds');
const HASH = createHash('sha256').update(ASSET).digest('hex');
const REQUEST_ID = 'asset-1';

interface WebScratch {
  /** Origins that hold the asset blob. */
  readonly holders: Set<string>;
  /** Every URL the shell fetched. */
  readonly asked: string[];
}

function web(world: CoreWorld): WebScratch {
  let value = scratch(world).blossomWeb as WebScratch | undefined;
  if (!value) {
    value = { holders: new Set(), asked: [] };
    scratch(world).blossomWeb = value;
    const state = value;
    // Stands in for the network the shell's web bridge reaches; it is captured when the shell is composed.
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      state.asked.push(url.href);
      return state.holders.has(url.origin) && url.pathname === `/${HASH}` ? new Response(ASSET) : new Response('missing', { status: 404 });
    });
  }
  return value;
}

After(() => {
  vi.unstubAllGlobals();
});

Given('a fake applesauce pool serving a signed manifest for {string} whose servers are {string}', async (world: CoreWorld, dTag: string, servers: string) => {
  const manifest = await signManifest({ dTag, requires: ['resource'], servers: splitList(servers) });
  const pool = createFakePool();
  pool.events = [manifest.event];
  scratch(world).manifest = manifest;
  scratch(world).pool = pool;
  web(world);
});

Given('the web holds the asset blob on {string}', (world: CoreWorld, origin: string) => {
  web(world).holders.add(origin);
});

When('the applet asks for the asset blob as {string} over its port', async (world: CoreWorld, reference: string) => {
  k(world).channel?.port1.postMessage({ type: 'resource.bytes', id: REQUEST_ID, url: reference.replaceAll('HASH', HASH) });
  for (let i = 0; i < 10 && !k(world).received.some((entry) => entry.id === REQUEST_ID); i += 1) await settle();
});

Then('the applet received the asset blob', (world: CoreWorld) => {
  const answer = k(world).received.find((entry) => entry.id === REQUEST_ID);
  expect(answer?.type).toBe('resource.bytes.result');
  expect(Buffer.from(String(answer?.blob), 'base64')).toEqual(Buffer.from(ASSET));
});

Then('the applet was told {string} for the asset blob', (world: CoreWorld, code: string) => {
  const answer = k(world).received.find((entry) => entry.id === REQUEST_ID);
  expect(answer).toMatchObject({ type: 'resource.bytes.error', error: code });
});

Then('the web was asked only {string}', (world: CoreWorld, urls: string) => {
  expect(web(world).asked).toEqual(splitList(urls.replaceAll('HASH', HASH)));
});

Then('the bridge reason {string} reaches the applet as {string}', (_world: CoreWorld, reason: string, code: string) => {
  const error = resourceErrorFor(new Error(reason));
  expect(error.code).toBe(code);
  expect(error.message).toBe(reason);
  expect(resourceErrorFor(reason).code).toBe(code);
});

async function attempt(world: CoreWorld, run: () => Promise<BridgeResult>): Promise<void> {
  scratch(world).blossomOutcome = await run().then((result) => ({ result }), (error: Error) => ({ error: error.message }));
}

const outcome = (world: CoreWorld) => scratch(world).blossomOutcome as { result?: BridgeResult; error?: string } | undefined;

When("the shell's bridges resolve the asset blob for the shell", (world: CoreWorld) =>
  attempt(world, () => k(world).kernl.bridges.resolve(`blossom:sha256:${HASH}`, { requester: 'shell' })));

When("the shell's bridges resolve the asset blob for an applet that is not running", (world: CoreWorld) => {
  const stranger: BridgeContext['requester'] = { dTag: 'chat', hash: 'cd'.repeat(32) };
  return attempt(world, () => k(world).kernl.bridges.resolve(`blossom:sha256:${HASH}`, { requester: stranger }));
});

Then("the shell's bridges failed with {string}", (world: CoreWorld, reason: string) => {
  expect(outcome(world)?.error).toBe(reason);
});

When('default bridges built with their own fetch resolve the asset blob from {string}', (world: CoreWorld, server: string) => {
  const own: string[] = [];
  scratch(world).ownFetches = own;
  const bridges = createDefaultBridges({
    http: { fetch: async (input) => (own.push(String(input)), new Response(ASSET)) },
    blossomServers: () => [server],
  });
  return attempt(world, () => bridges.resolve(`blossom:sha256:${HASH}`, { requester: { dTag: 'chat', hash: 'ab'.repeat(32) } }));
});

Then('the default bridges returned the asset blob through their own fetch', async (world: CoreWorld) => {
  const result = outcome(world)?.result;
  if (result?.kind !== 'bytes') throw new Error(`expected bytes, got ${outcome(world)?.error}`);
  expect(Buffer.from(await result.response.arrayBuffer())).toEqual(Buffer.from(ASSET));
  expect(scratch(world).ownFetches).toEqual([`https://applet-files.example/${HASH}`]);
  // The stubbed global fetch was not used.
  expect(web(world).asked).toEqual([]);
});

