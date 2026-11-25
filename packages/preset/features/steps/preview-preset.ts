import { createHash } from 'node:crypto';
import { expect, vi } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { PrivateKeySigner } from 'applesauce-signers';
import type { NostrEvent } from 'applesauce-core/helpers';
import { addressOf, createThrowawayIdentity, type AppletSummary, type KernlHost, type StorageLike } from '@kernlize/kernel';
import type { DownloadProgram } from '@kernlize/modules';
import { createKernl, previewPreset, shippedSamples, PREVIEW_CORRESPONDENTS, PREVIEW_REPLIES, type PreviewPreset, type PreviewSample, type ShippedSamples } from '@kernlize/preset';

type Shell = ReturnType<typeof createKernl<PreviewPreset['modules']>>;

interface PreviewWorld {
  preview: PreviewPreset;
  samples: Map<string, { manifest: NostrEvent; html: string }>;
  publisher: string;
  kernl?: Shell;
  owner: string;
  summary?: AppletSummary;
  refusal?: string;
  checked?: string;
  calls: { fetch: number; webSocket: number; caches: number };
  webPage?: string;
  toolSearch?: string;
  sent: number;
  listing?: ShippedSamples;
  opened: string[];
  engine: string[];
}

const publisherSigner = new PrivateKeySigner();
const settle = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const htmlOf = (name: string): string => `<!doctype html><html><head><title>${name}</title></head><body>${name}</body></html>`;
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

async function signSample(name: string): Promise<{ manifest: NostrEvent; html: string }> {
  const html = htmlOf(name);
  const manifest = await publisherSigner.signEvent({ kind: 35129, created_at: 1_764_000_000, content: `The ${name} sample.`, tags: [['d', name], ['x', sha256(html)], ['title', name], ['R', 'identity']] });
  return { manifest, html };
}

async function publisherProfile(): Promise<NostrEvent> {
  return publisherSigner.signEvent({ kind: 0, created_at: 1_764_000_000, tags: [], content: '{"name":"kernl samples"}' });
}

class MemoryStorage implements StorageLike {
  private readonly items = new Map<string, string>();
  getItem = (key: string): string | null => this.items.get(key) ?? null;
  setItem = (key: string, value: string): void => void this.items.set(key, value);
  removeItem = (key: string): void => void this.items.delete(key);
}

async function prepare(world: PreviewWorld, served: (name: string, html: string) => PreviewSample['bytes'] = (_name, html) => html): Promise<void> {
  world.samples = new Map([['notes', await signSample('notes')], ['pulse', await signSample('pulse')]]);
  world.publisher = await publisherSigner.getPublicKey();
  world.calls = { fetch: 0, webSocket: 0, caches: 0 };
  world.sent = 0;
  const samples = [...world.samples].map(([name, { manifest, html }]) => ({ manifest, bytes: served(name, html) }));
  world.preview = previewPreset({ samples, seed: [await publisherProfile()], replyDelayMs: 900 });
}

Given('a preview with two signed samples, {string} and {string}', async (world: PreviewWorld) => {
  await prepare(world);
});

Given('a preview whose {string} sample is served with one byte changed', async (world: PreviewWorld, changed: string) => {
  world.kernl?.destroy();
  await prepare(world, (name, html) => (name === changed ? () => Promise.resolve(new TextEncoder().encode(`${html} `)) : html));
});

Given('a preview built from a shipped samples listing with its publisher\'s profile', async (world: PreviewWorld) => {
  world.kernl?.destroy();
  await prepare(world);
  const listing = { publisher: world.publisher, profile: await publisherProfile(), samples: [...world.samples].map(([name, { manifest }]) => ({ name, manifest, file: `${name}.html` })) };
  const files = new Map([...world.samples].map(([name, { html }]) => [`${name}.html`, html]));
  world.preview = previewPreset(shippedSamples(listing, async (file) => files.get(file) as string));
  world.listing = listing;
});

Given('a shell composed from that preview, signed in with a throwaway identity', (world: PreviewWorld) => {
  vi.stubGlobal('fetch', () => {
    world.calls.fetch += 1;
    return Promise.reject(new Error('the page fetched'));
  });
  vi.stubGlobal('WebSocket', function WebSocket() {
    world.calls.webSocket += 1;
    throw new Error('the page opened a socket');
  });
  vi.stubGlobal('caches', { open: () => (world.calls.caches += 1, Promise.reject(new Error('the page opened Cache Storage'))) });
  world.opened = [];
  const host: KernlHost = { storage: new MemoryStorage(), notify: () => undefined, openLink: (url) => void world.opened.push(url), getVisibility: () => ({ visible: true, focused: true }), onRevoked: () => undefined };
  const kernl = createKernl(world.preview.options(host));
  const account = createThrowawayIdentity();
  kernl.accounts.addAccount(account);
  kernl.accounts.setActive(account);
  world.owner = account.pubkey;
  world.kernl = kernl;
});

After((world: PreviewWorld) => {
  world.kernl?.destroy();
  vi.unstubAllGlobals();
});

const shell = (world: PreviewWorld): Shell => world.kernl as Shell;

async function open(world: PreviewWorld, name: string): Promise<void> {
  const { manifest } = world.samples.get(name) as { manifest: NostrEvent };
  try {
    world.summary = await shell(world).resolve(shell(world).decodePointer(addressOf(manifest, ['wss://relay.example'])));
  } catch (error) {
    world.refusal = (error as Error).message;
  }
}

When('the person opens the {string} sample by its address', (world: PreviewWorld, name: string) => open(world, name));

Then('the shell verified {string} from its publisher with the bytes its manifest names', (world: PreviewWorld, name: string) => {
  expect(world.refusal).toBeUndefined();
  expect(world.summary?.identity.dTag).toBe(name);
  expect(world.summary?.publisher).toBe(world.publisher);
  expect(world.summary?.title).toBe(name);
});

Then('the shell refused it as {string}', (world: PreviewWorld, reason: string) => {
  expect(world.summary).toBeUndefined();
  expect(world.refusal).toBe(reason);
});

When('the shell asks the preview for a blob it does not hold', async (world: PreviewWorld) => {
  await world.preview.fetchBlob('0'.repeat(64), []).catch((error: Error) => (world.refusal = error.message));
});

Then('the blob is refused as {string}', (world: PreviewWorld, reason: string) => {
  expect(world.refusal).toBe(reason);
});

When('the store loads its catalogue', async (world: PreviewWorld) => {
  world.checked = (await shell(world).catalog.load()).map((entry) => `${entry.title}@${entry.publisher}`).sort().join(', ');
});

Then('it lists {string} from the samples\' publisher', (world: PreviewWorld, names: string) => {
  expect(world.checked).toBe(names.split(', ').map((name) => `${name}@${world.publisher}`).join(', '));
});

Then('the profiles read {string}, {string} and {string}', async (world: PreviewWorld, ada: string, grace: string, publisher: string) => {
  const names = await Promise.all([PREVIEW_CORRESPONDENTS.ada, PREVIEW_CORRESPONDENTS.grace, world.publisher].map(async (pubkey) => (await shell(world).profiles.settled(pubkey)).name));
  expect(names).toEqual([ada, grace, publisher]);
});

async function historyOf(world: PreviewWorld, provider: string): Promise<{ senderPubkey: string; createdAt: number; content: string }[]> {
  const backend = shell(world).messaging.list().find((entry) => entry.provider.id === provider);
  expect(backend?.enabled).toBe(true);
  const composite = shell(world).messaging.composite();
  const { conversations } = await composite.conversations({});
  const mine = conversations.filter((conversation) => conversation.id.startsWith(`${provider}:`));
  const pages = await Promise.all(mine.map((conversation) => composite.messages({ conversationId: conversation.id })));
  return pages.flatMap((page) => page.messages);
}

Then('the {string} provider holds {int} line(s) from Ada, the first {int} seconds ago', async (world: PreviewWorld, provider: string, count: number, ago: number) => {
  const lines = await historyOf(world, provider);
  expect(lines.map((line) => line.senderPubkey)).toEqual(Array(count).fill(PREVIEW_CORRESPONDENTS.ada));
  expect(Math.floor(Date.now() / 1000) - (lines[0]?.createdAt as number)).toBeGreaterThanOrEqual(ago);
  expect(Math.floor(Date.now() / 1000) - (lines[0]?.createdAt as number)).toBeLessThan(ago + 5);
});

Then('the {string} provider holds {int} line(s) from Grace, {int} seconds ago', async (world: PreviewWorld, provider: string, count: number, ago: number) => {
  const lines = await historyOf(world, provider);
  expect(lines.map((line) => line.senderPubkey)).toEqual(Array(count).fill(PREVIEW_CORRESPONDENTS.grace));
  expect(Math.floor(Date.now() / 1000) - (lines[0]?.createdAt as number)).toBeLessThan(ago + 5);
});

Then('the conversations are named {string} and {string}', async (world: PreviewWorld, ada: string, grace: string) => {
  await Promise.all([PREVIEW_CORRESPONDENTS.ada, PREVIEW_CORRESPONDENTS.grace].map((pubkey) => shell(world).profiles.settled(pubkey)));
  const { conversations } = await shell(world).messaging.composite().conversations({});
  const labels = conversations.flatMap((conversation) => conversation.participants.map((participant) => participant.label));
  expect(labels.sort()).toEqual([ada, grace]);
});

async function send(world: PreviewWorld, content: string): Promise<void> {
  await shell(world).messaging.composite().send({ recipients: [PREVIEW_CORRESPONDENTS.ada], content });
  world.sent += 1;
}

When('the person writes {string} to Ada and then again to Ada', async (world: PreviewWorld, content: string) => {
  await send(world, content);
  await send(world, content);
});

async function repliesFromAda(world: PreviewWorld): Promise<string[]> {
  const lines = await historyOf(world, 'private');
  return lines.filter((line) => line.senderPubkey === PREVIEW_CORRESPONDENTS.ada).map((line) => line.content).slice(2);
}

Then('Ada replies {string} after about {int} ms', async (world: PreviewWorld, reply: string, ms: number) => {
  await settle(ms - 300);
  expect(await repliesFromAda(world)).toEqual([]);
  await settle(500);
  expect((await repliesFromAda(world))[0]).toBe(reply);
});

Then('then {string}', async (world: PreviewWorld, reply: string) => {
  expect(await repliesFromAda(world)).toEqual([PREVIEW_REPLIES[0], reply]);
});

Then('the messaging providers are {string}, with {string} switched on', (world: PreviewWorld, all: string, enabled: string) => {
  const entries = shell(world).messaging.list();
  expect(entries.map((entry) => entry.provider.id)).toEqual(all.split(', '));
  expect(entries.filter((entry) => entry.enabled).map((entry) => entry.provider.id)).toEqual(enabled.split(', '));
});

Then('the shell offers no {string} domain, not even as a baseline', (world: PreviewWorld, domain: string) => {
  expect(shell(world).grants.availableDomains()).not.toContain(domain);
  expect(shell(world).grants.baselineDomains()).not.toContain(domain);
});

Then('the shell offers no {string} domain', (world: PreviewWorld, domain: string) => {
  expect(shell(world).grants.availableDomains()).not.toContain(domain);
});

const signIn = (program: string, url: string) => ({ url, username: 'me', password: 'secret', ...(program === 'sabnzbd' ? { apiKey: 'key' } : {}) });

When('the person checks a {string} program at {string} with a sign-in', async (world: PreviewWorld, program: DownloadProgram, url: string) => {
  const checked = await shell(world).downloads.check(program, signIn(program, url));
  world.checked = checked.probe.version;
});

Then('the check says it is connected, version {string}', (world: PreviewWorld, version: string) => {
  expect(world.checked).toBe(version);
});

When('a {string} program at {string} is set up and asked what it holds', async (world: PreviewWorld, program: DownloadProgram, url: string) => {
  await shell(world).downloads.add(program, signIn(program, url));
  const { downloads } = shell(world);
  // Soulseek has no list of jobs; asking what one transfer is doing is the same kind of request.
  const holds = program === 'slskd' ? downloads.routing('soulseek').preferred()!.client.transfer('someone', 'one').then(() => []) : (downloads.routing(program === 'sabnzbd' || program === 'nzbget' ? 'nzb' : 'torrent').preferred()!.client.list() as Promise<readonly unknown[]>);
  world.checked = await holds.then(
    (jobs) => (jobs.length === 0 ? 'no jobs' : `${jobs.length} jobs`),
    (error: Error) => error.message,
  );
});

Then('it answers {string}', (world: PreviewWorld, answer: string) => {
  expect(world.checked).toBe(answer);
});

When('the person opens the {string} sample, loads the store, reads profiles, writes to Ada, checks a download program, fetches a web page through the bridges and searches for tools', async (world: PreviewWorld, name: string) => {
  await open(world, name);
  await shell(world).catalog.load();
  await shell(world).profiles.settled(PREVIEW_CORRESPONDENTS.ada);
  await send(world, 'hello');
  await shell(world).downloads.check('transmission', { url: 'http://127.0.0.1:9091' });
  world.webPage = await shell(world).bridges.resolve('https://example.com/', { requester: 'shell' }).then(() => 'fetched', (error: Error) => error.message);
  world.toolSearch = await shell(world).multiplayer.discover('weather').then(() => 'found', (error: Error) => error.message);
  await settle(1000);
});

Then('the pool only ever dialled sockets that live in the page', (world: PreviewWorld) => {
  const dialled = [...world.preview.pool.relays.keys()];
  expect(dialled.length).toBeGreaterThan(0);
  expect(world.calls.webSocket).toBe(0);
});

Then('nothing called the page\'s fetch, opened its WebSocket or its Cache Storage', (world: PreviewWorld) => {
  expect(world.calls).toEqual({ fetch: 0, webSocket: 0, caches: 0 });
});

Then('the web page was refused as {string}', (world: PreviewWorld, reason: string) => {
  expect(world.webPage).toBe(reason);
});

Then('the tool search was refused as {string}', (world: PreviewWorld, reason: string) => {
  expect(world.toolSearch).toBe(reason);
});

Then('the same listing without the profile seeds nothing but the samples', (world: PreviewWorld) => {
  const { profile: _profile, ...bare } = world.listing as ShippedSamples;
  const parts = shippedSamples(bare, async () => '');
  expect(parts.seed).toEqual([]);
  expect(parts.samples.map((sample) => sample.manifest.id)).toEqual(bare.samples.map((sample) => sample.manifest.id));
});

When('the person answers Grace in her conversation', async (world: PreviewWorld) => {
  const composite = shell(world).messaging.composite();
  const { conversations } = await composite.conversations({});
  const grace = conversations.find((conversation) => conversation.participants.some((participant) => participant.pubkey === PREVIEW_CORRESPONDENTS.grace));
  await composite.send({ conversationId: grace!.id, recipients: [], content: 'hello' });
});

Then('Grace replies {string} after about {int} ms', async (world: PreviewWorld, reply: string, ms: number) => {
  const fromGrace = async (): Promise<string[]> => (await historyOf(world, 'legacy')).filter((line) => line.senderPubkey === PREVIEW_CORRESPONDENTS.grace).map((line) => line.content).slice(1);
  await settle(ms - 300);
  expect(await fromGrace()).toEqual([]);
  await settle(500);
  expect(await fromGrace()).toEqual([reply]);
});

const MAGNET = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567';

When('an applet\'s magnet link is resolved through the bridges', async (world: PreviewWorld) => {
  await shell(world).bridges.resolve(MAGNET, { requester: 'shell' });
});

Then('the preview\'s host was asked to open {string}', (world: PreviewWorld, url: string) => {
  expect(world.opened).toEqual([url]);
});

Given('a preview with a torrent engine of the host\'s own', async (world: PreviewWorld) => {
  await prepare(world);
  world.engine = [];
  world.preview = previewPreset({ torrent: { add: async (infoHash) => (world.engine.push(infoHash), { id: 'job', name: 'sample' }) } });
});

Then('the host\'s engine took it and the host was asked to open nothing', (world: PreviewWorld) => {
  expect(world.engine).toEqual(['0123456789abcdef0123456789abcdef01234567']);
  expect(world.opened).toEqual([]);
});

Given('a preview given nothing', async (world: PreviewWorld) => {
  await prepare(world);
  world.preview = previewPreset();
});

Then('the store lists nothing', (world: PreviewWorld) => {
  expect(world.checked).toBe('');
});

Then('Ada and Grace have names', async (world: PreviewWorld) => {
  const names = await Promise.all([PREVIEW_CORRESPONDENTS.ada, PREVIEW_CORRESPONDENTS.grace].map(async (pubkey) => (await shell(world).profiles.settled(pubkey)).name));
  expect(names).toEqual(['Ada', 'Grace']);
});
