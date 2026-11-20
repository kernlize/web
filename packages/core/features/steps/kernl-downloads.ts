import { expect, vi } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import type { BridgeRegistry, BridgeResult } from '@kernlize/bridges';
import { createKernlDownloads, createStorageSecrets, describeDownloadQuestion, supportsDomainBindings, type AppletIdentity, type ConsentPrompt, type KernlDownloads } from '@kernlize/core';
import { startFakeNzbget, type FakeNzbget } from '../../../bridges/features/steps/fake-nzbget.ts';
import { startFakeSlskd, type FakeSlskd } from '../../../bridges/features/steps/fake-slskd.ts';
import { startFakeTransmission, type FakeTransmission } from '../../../bridges/features/steps/fake-transmission.ts';
import { blobFetcher, boot, k, settle } from './kernl.js';
import { MemoryStorage, scratch, type CoreWorld } from './world.js';

interface DownloadsScratch {
  transmission?: FakeTransmission;
  nzbget?: FakeNzbget;
  slskd?: FakeSlskd;
  services?: KernlDownloads;
  prompts: ConsentPrompt[];
  sent: Record<string, unknown>[];
}

const NZB = '<?xml version="1.0" encoding="UTF-8"?><nzb xmlns="http://www.newzbin.com/DTD/2003/nzb"><file poster="a@example.net" date="1793361600" subject="example.txt"><groups><group>alt.test</group></groups><segments><segment bytes="8" number="1">part1@example.net</segment></segments></file></nzb>';
const IDENTITY: AppletIdentity = { dTag: 'chat', hash: 'ab'.repeat(32) };
const WAIT = { timeout: 3000, interval: 10 };

function bag(world: CoreWorld): DownloadsScratch {
  const state = scratch(world) as { downloads?: DownloadsScratch };
  state.downloads ??= { prompts: [], sent: [] };
  return state.downloads;
}

const answer = (world: CoreWorld, type: string): Record<string, unknown> | undefined => k(world).received.find((entry) => entry.type === type);

async function answered(world: CoreWorld, type: string): Promise<Record<string, unknown>> {
  await vi.waitFor(() => expect(answer(world, type)).toBeDefined(), WAIT);
  return answer(world, type) as Record<string, unknown>;
}

function bridgesAnswering(world: CoreWorld, result: () => BridgeResult): BridgeRegistry {
  return {
    register: () => undefined,
    list: () => [],
    forScheme: () => undefined,
    async resolve(uri, context) {
      k(world).bridgeCalls.push({ uri, requester: context.requester });
      return result();
    },
  };
}

After(async (world: CoreWorld) => {
  const state = (scratch(world) as { downloads?: DownloadsScratch }).downloads;
  state?.services?.dispose();
  await Promise.all([state?.transmission?.close(), state?.nzbget?.close(), state?.slskd?.close()]);
});

Given('a kernl shell that offers the download domains', (world: CoreWorld) => {
  boot(world, { downloads: { offer: true } }, blobFetcher(world));
});

Given('a kernl shell that offers the download domains, with a Transmission program set up', async (world: CoreWorld) => {
  bag(world).transmission = await startFakeTransmission();
  boot(world, { downloads: { offer: true } }, blobFetcher(world));
  await k(world).kernl.downloads.add('transmission', { url: bag(world).transmission?.url as string });
});

async function bootWithNzbget(world: CoreWorld, result: () => BridgeResult): Promise<void> {
  bag(world).nzbget = await startFakeNzbget();
  boot(world, { downloads: { offer: true }, bridges: bridgesAnswering(world, result) }, blobFetcher(world));
  const { url, login } = bag(world).nzbget as FakeNzbget;
  await k(world).kernl.downloads.add('nzbget', { url, ...login });
}

Given('a kernl shell that offers the download domains, with an NZBGet program set up and bridges that fetch an archive listing', (world: CoreWorld) =>
  bootWithNzbget(world, () => ({ kind: 'bytes', response: new Response(NZB, { status: 200 }) })));

Given('a kernl shell that offers the download domains, with an NZBGet program set up and bridges that answer with a job', (world: CoreWorld) =>
  bootWithNzbget(world, () => ({ kind: 'job', id: 'handoff:1', label: 'x' })));

Given('download services over a sharing daemon, for a window that stops being an applet once the daemon is asked', async (world: CoreWorld) => {
  const state = bag(world);
  state.slskd = await startFakeSlskd();
  state.slskd.online = true;
  let live = true;
  const storage = new MemoryStorage();
  state.services = createKernlDownloads({
    host: { storage, presentConsent: (prompt) => void state.prompts.push(prompt), now: () => 1_793_361_600_000 },
    options: {
      offer: true,
      pageScheme: () => 'http',
      fetch: (input, init) => {
        live = false;
        return fetch(input, init);
      },
    },
    secrets: createStorageSecrets(storage),
    identityOf: () => (live ? IDENTITY : undefined),
    fetchDocument: () => Promise.reject(new Error('unavailable:not-used')),
  });
  const { lock } = state.slskd;
  await state.services.programs.add('slskd', { url: state.slskd.url, ...(lock?.apiKey ? { apiKey: lock.apiKey } : {}) });
  live = true;
});

When('the applet asks to add the magnet for {string} over its port', async (world: CoreWorld, hash: string) => {
  k(world).channel?.port1.postMessage({ type: 'torrent.add', id: 'add-1', request: { source: { sourceType: 'magnet', magnet: `magnet:?xt=urn:btih:${hash}&dn=archive` } } });
  await settle();
});

When('the applet asks which archive downloaders there are over its port', (world: CoreWorld) => {
  k(world).channel?.port1.postMessage({ type: 'nzb.downloaders', id: 'downloaders-1' });
});

When('the applet asks about the sharing daemon over its port', (world: CoreWorld) => {
  k(world).channel?.port1.postMessage({ type: 'soulseek.info', id: 'info-1' });
});

When('the applet submits the archive at {string} over its port', async (world: CoreWorld, url: string) => {
  k(world).channel?.port1.postMessage({ type: 'nzb.downloaders', id: 'downloaders-1' });
  const listed = (await answered(world, 'nzb.downloaders.result')).result as { downloaders: { downloaderId: string; sourceKinds: string[] }[] };
  expect(listed.downloaders[0]?.sourceKinds).toEqual(['bytes', 'url']);
  k(world).channel?.port1.postMessage({ type: 'nzb.add', id: 'add-1', request: { downloaderId: listed.downloaders[0]?.downloaderId, operationKey: 'submit-1', source: { kind: 'url', url } } });
});

When('the host answers yes to the download question', async (world: CoreWorld) => {
  await vi.waitFor(() => expect(k(world).record.prompts.length).toBe(1), WAIT);
  k(world).record.prompts[0]?.resolve(true);
  await settle();
});

When('the host answers no to the download question', async (world: CoreWorld) => {
  await vi.waitFor(() => expect(k(world).record.prompts.length).toBe(1), WAIT);
  k(world).record.prompts[0]?.resolve(false);
  await settle();
});

When('that window searches the sharing daemon for {string}', (world: CoreWorld, text: string) => {
  const state = bag(world);
  state.services?.services.soulseek?.handleMessage('w1', { type: 'soulseek.search', id: 'search-1', request: { text } }, (message) => void state.sent.push(message as Record<string, unknown>));
});

Then('the installed prelude cannot bind a domain it does not build in', () => {
  expect(supportsDomainBindings()).toBe(false);
});

Then('a prelude that renders bindings can', () => {
  expect(supportsDomainBindings((options) => `<script>${JSON.stringify(options)}</script>`)).toBe(true);
});

Then("the shell's download settings name nothing set up, kept on {string}", (world: CoreWorld, label: string) => {
  expect(k(world).kernl.downloads.state()).toEqual({ connections: [], defaults: {}, locked: [] });
  expect(k(world).kernl.secrets).toEqual({ label, keeps: 'plain' });
});

Then('the host is asked {string} as a {string} question with no record to show', async (world: CoreWorld, title: string, severity: string) => {
  await vi.waitFor(() => expect(k(world).record.prompts.length).toBe(1), WAIT);
  const { summary } = k(world).record.prompts[0] as ConsentPrompt;
  expect(summary.title).toBe(title);
  expect(summary.severity).toBe(severity);
  expect(summary.event).toBeUndefined();
  expect(summary.applet).toEqual(k(world).summary?.identity);
  expect(summary.lines.map((line) => line.after).join(' ')).toContain('abcdef0123456789abcdef0123456789abcdef01');
});

Then('the host is asked a {string} question about the download', async (world: CoreWorld, severity: string) => {
  await vi.waitFor(() => expect(k(world).record.prompts.length).toBe(1), WAIT);
  const { summary } = k(world).record.prompts[0] as ConsentPrompt;
  expect(summary.severity).toBe(severity);
  expect(JSON.stringify(summary)).not.toContain('indexer.example');
});

Then('the applet is told the torrent was added', async (world: CoreWorld) => {
  const { ack } = (await answered(world, 'torrent.add.result')) as { ack: { ok: boolean; jobId: string } };
  expect(ack.ok).toBe(true);
  expect(ack.jobId).not.toContain('abcdef');
});

Then('the applet is told adding the torrent failed with {string}', async (world: CoreWorld, error: string) => {
  expect(((await answered(world, 'torrent.add.result')) as { ack: unknown }).ack).toMatchObject({ ok: false, error });
});

Then('the real program was asked to add that torrent', (world: CoreWorld) => {
  expect(bag(world).transmission?.calls.map((call) => call.method)).toContain('torrent-add');
  expect([...(bag(world).transmission?.torrents.keys() ?? [])]).toEqual(['abcdef0123456789abcdef0123456789abcdef01']);
});

Then('the real program was asked to add nothing', (world: CoreWorld) => {
  expect(bag(world).transmission?.calls.map((call) => call.method)).not.toContain('torrent-add');
});

Then('the applet is told there are {int} archive downloaders', async (world: CoreWorld, count: number) => {
  expect(((await answered(world, 'nzb.downloaders.result')).result as { downloaders: unknown[] }).downloaders).toHaveLength(count);
});

Then('the applet is told the sharing daemon is {string}', async (world: CoreWorld, state: string) => {
  expect(((await answered(world, 'soulseek.info.result')).value as { state: string }).state).toBe(state);
});

Then('the applet is told the archive was accepted as a job', async (world: CoreWorld) => {
  const { result } = (await answered(world, 'nzb.add.result')) as { result: { job: { jobId: string; state: string } } };
  expect(result.job.jobId).toBeTruthy();
  expect(bag(world).nzbget?.calls.map((call) => call.method)).toContain('append');
});

Then('the bridges were asked for {string} on the shell\'s behalf', (world: CoreWorld, url: string) => {
  expect(k(world).bridgeCalls).toEqual([{ uri: url, requester: 'shell' }]);
});

Then('the applet is told the archive failed with {string}', async (world: CoreWorld, code: string) => {
  expect(((await answered(world, 'nzb.add.result')) as { error: { code: string } }).error.code).toBe(code);
  expect(bag(world).nzbget?.calls.map((call) => call.method)).not.toContain('append');
  expect(k(world).record.prompts).toEqual([]);
});

Then('that window is told {string} and nobody was asked', async (world: CoreWorld, code: string) => {
  const state = bag(world);
  await vi.waitFor(() => expect(state.sent).toHaveLength(1), WAIT);
  expect(state.sent[0]).toMatchObject({ type: 'soulseek.search.result', id: 'search-1', error: { code } });
  expect(state.prompts).toEqual([]);
});

Then('a download question that deletes is {string}', (_world: CoreWorld, severity: string) => {
  expect(describeDownloadQuestion({ kind: 'delete', title: 'Delete', lines: [{ label: 'Name', value: 'a' }] }, IDENTITY, true)).toEqual({ title: 'Delete', severity, lines: [{ label: 'Name', after: 'a' }], applet: IDENTITY });
});

Then('a download question that shows peers an address is {string}', (_world: CoreWorld, severity: string) => {
  expect(describeDownloadQuestion({ kind: 'session', title: 'Search', lines: [] }, IDENTITY, true).severity).toBe(severity);
});

Then("a download question that only the person's servers see is {string}", (_world: CoreWorld, severity: string) => {
  expect(describeDownloadQuestion({ kind: 'add', title: 'Add', lines: [] }, IDENTITY, false).severity).toBe(severity);
});
