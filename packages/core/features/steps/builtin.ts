import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createMemoryBackend, type MemoryBackend, type ReplyPrompt } from '@kernlize/messaging';
import { BUILTIN_PUBLISHER, builtinAddress, type AppletPointer, type BuiltinApplet } from '@kernlize/core';
import { blobFetcher, boot, k } from './kernl.js';
import { attempt, scratch, splitList, type CoreWorld } from './world.js';


const HTML = '<!doctype html><html><head><title>Shipped</title></head><body><p>shipped</p></body></html>';
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

function shipped(id: string, parts: Partial<BuiltinApplet> = {}): BuiltinApplet {
  return { id, title: 'Shipped', description: 'Comes with the shell.', sha256: sha256(HTML), requires: [], optional: [], load: async () => HTML, ...parts };
}

Given(
  'a kernl shell that ships the applet {string} requiring {string} and starting with {string}',
  (world: CoreWorld, id: string, requires: string, grants: string) => {
    const applet = shipped(id, {
      requires: splitList(requires),
      optional: ['notify'],
      grants: splitList(grants),
      archetypes: [
        { slug: 'dm', convention: 'napplet:dm/open', params: ['pubkey'] },
        { slug: 'dm', convention: 'napplet:dm/list' },
      ],
    });
    boot(world, { builtins: [applet] }, blobFetcher(world));
  },
);

Given('a kernl shell that ships the bare applet {string}', (world: CoreWorld, id: string) => {
  boot(world, { builtins: [shipped(id)] }, blobFetcher(world));
});

Given('a kernl shell that ships the applet {string} with a hash its bytes do not match', (world: CoreWorld, id: string) => {
  boot(world, { builtins: [shipped(id, { sha256: 'ab'.repeat(32) })] }, blobFetcher(world));
});

Given('a kernl shell that ships the applet {string} whose file cannot be loaded', (world: CoreWorld, id: string) => {
  boot(world, { builtins: [shipped(id, { load: () => Promise.reject(new Error('chunk failed to load')) })] }, blobFetcher(world));
});

When('the shell resolves the address {string}', async (world: CoreWorld, address: string) => {
  const { kernl } = k(world);
  await attempt(world, async () => {
    k(world).summary = await kernl.resolve(kernl.decodePointer(address));
  });
});

When('the shell revokes {string} for the resolved applet', (world: CoreWorld, domain: string) => {
  const summary = k(world).summary;
  if (!summary) throw new Error('resolve first');
  k(world).kernl.grants.revokeDomain(summary.identity, domain);
});

Then('the pointer is the built-in applet {string}', (world: CoreWorld, id: string) => {
  expect(scratch(world).pointer as AppletPointer).toMatchObject({ kind: 'builtin', id });
});

Then('the shell summary is the built-in applet {string} requiring {string}', (world: CoreWorld, id: string, requires: string) => {
  expect(k(world).summary).toMatchObject({
    identity: { dTag: id, hash: sha256(HTML) },
    address: builtinAddress(id),
    publisher: BUILTIN_PUBLISHER,
    builtin: true,
    requires: splitList(requires),
    manifest: { artifactHash: sha256(HTML), catalogId: `nip5d:35129:${BUILTIN_PUBLISHER}:${id}` },
  });
});

Then('the shell summary takes {string} with parameters {string}', (world: CoreWorld, convention: string, parameters: string) => {
  expect(k(world).summary?.manifest.intents).toContainEqual({ identity: convention, parameters: splitList(parameters) });
  expect(k(world).summary?.archetypes).toEqual(['dm']);
});

Then('the shell lists {string} as installed at {string}', (world: CoreWorld, id: string, address: string) => {
  expect(k(world).kernl.intents.installed().map((applet) => ({ id: applet.catalogId, address: applet.address }))).toEqual([
    { id: `nip5d:35129:${BUILTIN_PUBLISHER}:${id}`, address },
  ]);
});

interface ReplyScratch {
  readonly prompts: ReplyPrompt[];
  readonly backends: Record<string, MemoryBackend>;
  conversationId?: string;
}

const reply = (world: CoreWorld): ReplyScratch => scratch(world).reply as ReplyScratch;

Given(
  'a kernl shell whose host answers the reply question with {string}, over memory backends for {string} and {string}',
  (world: CoreWorld, use: string, first: string, second: string) => {
    const state: ReplyScratch = { prompts: [], backends: { [first]: createMemoryBackend(), [second]: createMemoryBackend() } };
    scratch(world).reply = state;
    boot(
      world,
      { messagingBackends: { [first]: () => state.backends[first] as MemoryBackend, [second]: () => state.backends[second] as MemoryBackend } },
      {
        ...blobFetcher(world),
        async chooseReply(prompt) {
          state.prompts.push(prompt);
          return { use: use as 'theirs' | 'mine', remember: 'once' };
        },
      },
    );
  },
);

When('{string} writes to the account through {string}', (world: CoreWorld, sender: string, provider: string) => {
  reply(world).backends[provider]?.deliver({ senderPubkey: sender, content: 'hello', createdAt: 100 });
});

When("an applet's message to {string} is sent through the shell's messaging", async (world: CoreWorld, recipient: string) => {
  const result = await k(world).kernl.messaging.composite().send({ recipients: [recipient], content: 'hi back' });
  reply(world).conversationId = result.message.conversationId;
});

Then('the host was asked about a reply to {string} from {string} to {string}', (world: CoreWorld, peer: string, mine: string, theirs: string) => {
  expect(reply(world).prompts.map((prompt) => ({ peer: prompt.peer.pubkey, mine: prompt.mine.name, theirs: prompt.theirs.name }))).toEqual([{ peer, mine, theirs }]);
});

Then('the message left through {string}', (world: CoreWorld, provider: string) => {
  expect(reply(world).conversationId?.startsWith(`${provider}:`)).toBe(true);
});

Then("the shell's switched-on messaging providers are {string}", (world: CoreWorld, ids: string) => {
  const running = k(world).kernl.messaging.list().filter((entry) => entry.enabled).map((entry) => entry.provider.id);
  expect(running).toEqual(splitList(ids));
});

Then("the shell's first messaging provider is {string}", (world: CoreWorld, id: string) => {
  expect(k(world).kernl.messaging.preferences().defaultProvider).toBe(id);
});
