import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createAskChannel, type Ask, type AskChannel, type AskHost, type AskKind, type AskRenderers, type KernelContext, type KernlHost, type KernlModule } from '@kernlize/core';
import { startFakeTransmission } from '../../../bridges/features/steps/fake-transmission.ts';
import { blobFetcher, boot, k, settle } from './kernl.js';
import { attempt, scratch, splitList, type CoreWorld } from './world.js';

interface AsksScratch {
  channel?: AskChannel;
  answer?: Promise<unknown>;
  drawn: Ask[];
  answers: Array<(answer: unknown) => void>;
  password?: string;
  consentPromptsBefore?: number;
}

const asks = (world: CoreWorld): AsksScratch => {
  const state = scratch(world) as { asks?: AsksScratch };
  state.asks ??= { drawn: [], answers: [] };
  return state.asks;
};

const APPLET = { dTag: 'chat', hash: 'ab'.repeat(32) };

/** An ask of a kind, with stand-in facts: the channel reads only the kind, the window and the applet. */
const askOf = (kind: AskKind, windowId?: string): Ask => ({ kind, applet: APPLET, ...(windowId === undefined ? {} : { windowId }), facts: {} as never, defaultText: { title: kind } as never });

const NO_PROMPTS: Partial<KernlHost> = { presentConsent: undefined, presentApproval: undefined, chooseHandler: undefined, chooseReply: undefined, presentSettings: undefined };

function channelOver(world: CoreWorld, host: AskHost, isAsking?: (windowId: string) => boolean): void {
  asks(world).channel = createAskChannel({ host, ...(isAsking ? { isAsking } : {}) });
}

Given('an ask channel over a host that draws nothing', (world: CoreWorld) => channelOver(world, {}));

Given('an ask channel over a host whose {string} renderer throws', (world: CoreWorld, kind: AskKind) =>
  channelOver(world, { asks: { [kind]: () => { throw new Error('broken'); } } }));

Given('an ask channel over a host whose {string} renderer rejects', (world: CoreWorld, kind: AskKind) =>
  channelOver(world, { asks: { [kind]: () => Promise.reject(new Error('broken')) } }));

Given('an ask channel over a host whose {string} renderer answers yes after an hour', (world: CoreWorld, kind: AskKind) => {
  channelOver(world, { asks: { [kind]: () => new Promise((resolve) => setTimeout(() => resolve(true), 60 * 60 * 1000)) } as AskRenderers });
});

Given('an ask channel whose windows run other applets than the ones that asked, over a host that answers {string} yes', (world: CoreWorld, kind: AskKind) =>
  channelOver(world, { asks: { [kind]: () => true } as AskRenderers }, () => false));

When('the kernel asks {string}', (world: CoreWorld, kind: AskKind) => {
  asks(world).answer = (asks(world).channel as AskChannel).ask(askOf(kind));
});

When('the kernel asks {string} for window {string}', (world: CoreWorld, kind: AskKind, windowId: string) => {
  asks(world).answer = (asks(world).channel as AskChannel).ask(askOf(kind, windowId));
});

When('the kernel asks {string} and an hour passes', async (world: CoreWorld, kind: AskKind) => {
  // Faked inside the step only, so the step's own timeout keeps real time.
  vi.useFakeTimers();
  try {
    asks(world).answer = (asks(world).channel as AskChannel).ask(askOf(kind));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  } finally {
    vi.useRealTimers();
  }
});

Then('the ask was answered no', async (world: CoreWorld) => {
  expect(await asks(world).answer).toBe(false);
});

Then('the ask was answered yes', async (world: CoreWorld) => {
  expect(await asks(world).answer).toBe(true);
});

Then('the ask was answered with nothing', async (world: CoreWorld) => {
  expect(await asks(world).answer).toBeUndefined();
});

/** Renderers that keep each ask and wait for the scenario to answer it. */
function drawing(world: CoreWorld, kinds: readonly AskKind[]): AskRenderers {
  const state = asks(world);
  const draw = (ask: Ask): Promise<unknown> => new Promise((resolve) => {
    state.drawn.push(ask);
    state.answers.push(resolve);
  });
  return Object.fromEntries(kinds.map((kind) => [kind, draw])) as AskRenderers;
}

Given('a kernl shell over that host and pool whose host draws nothing', (world: CoreWorld) => {
  boot(world, {}, { ...blobFetcher(world), ...NO_PROMPTS });
});

Given('a kernl shell over that host and pool whose host draws {string} and answers later', (world: CoreWorld, kinds: string) => {
  boot(world, {}, { ...blobFetcher(world), asks: drawing(world, splitList(kinds) as AskKind[]) });
});

Then('the host drew a {string} ask for the mounted window', async (world: CoreWorld, kind: string) => {
  await vi.waitFor(() => expect(asks(world).drawn.map((ask) => ask.kind)).toContain(kind));
  const ask = asks(world).drawn.find((drawn) => drawn.kind === kind) as Ask;
  expect(ask.windowId).toBe(k(world).plan?.windowId);
});

Then('the ask names the applet {string}, carries a kind {int} draft and says {string}', (world: CoreWorld, dTag: string, kind: number, title: string) => {
  const ask = asks(world).drawn[0] as Ask<'sign.replace'>;
  expect(ask.applet?.dTag).toBe(dTag);
  expect(ask.facts.draft.kind).toBe(kind);
  expect(ask.defaultText.title).toBe(title);
});

When('the host answers the ask yes', async (world: CoreWorld) => {
  asks(world).answers[0]?.(true);
  await settle();
});

When('the host answers the ask no', async (world: CoreWorld) => {
  asks(world).answers[0]?.(false);
  await settle();
});

Then('the host drew a firewall ask saying {string} about {string} of {string}', async (world: CoreWorld, title: string, operation: string, target: string) => {
  await vi.waitFor(() => expect(asks(world).drawn.map((ask) => ask.kind)).toContain('firewall.approve'));
  const ask = asks(world).drawn.find((drawn) => drawn.kind === 'firewall.approve') as Ask<'firewall.approve'>;
  expect(ask.defaultText.title).toBe(title);
  expect(ask.facts.requests).toContainEqual(expect.objectContaining({ operation, target }));
  expect(ask.signal?.aborted).toBe(false);
});

When('the host answers the ask with {string}', async (world: CoreWorld, answer: string) => {
  asks(world).answers[0]?.(answer);
  await settle();
});

Then("the host's consent prompt was not used", (world: CoreWorld) => {
  expect(k(world).record.prompts).toEqual([]);
});

/** A module that declares one kind and lets a scenario ask through its context. */
const asker: KernlModule<'asker', KernelContext> = { id: 'asker', asks: ['connection.direct'], setup: (context) => ({ api: context }) };

Given('a kernl shell over that host and pool whose host draws nothing, with modules {string}', (world: CoreWorld, names: string) => {
  boot(world, { modules: splitList(names).map(() => asker) }, { ...blobFetcher(world), ...NO_PROMPTS });
});

When('the {string} module asks {string}', async (world: CoreWorld, id: string, kind: AskKind) => {
  const context = Reflect.get(k(world).kernl, id) as KernelContext;
  await attempt(world, async () => {
    asks(world).answer = Promise.resolve(await context.ask(askOf(kind, 'applet-1')));
  });
});

Then("the module's ask was refused with {string}", (world: CoreWorld, reason: string) => {
  expect(scratch(world).errors.pop()?.message).toBe(reason);
});

Then("the module's ask was answered no", async (world: CoreWorld) => {
  expect(scratch(world).errors).toEqual([]);
  expect(await asks(world).answer).toBe(false);
});

Then('the {string} module is told the host draws no {string}', (world: CoreWorld, id: string, kind: AskKind) => {
  expect((Reflect.get(k(world).kernl, id) as KernelContext).canAsk(kind)).toBe(false);
});

Given('a kernl shell that offers the download domains, with a Transmission program that signs in with a password, whose host draws {string}', async (world: CoreWorld, kinds: string) => {
  const transmission = await startFakeTransmission();
  // Kept where the downloads steps close their programs after the scenario.
  (scratch(world) as { downloads?: { prompts: never[]; sent: never[]; transmission: typeof transmission } }).downloads = { prompts: [], sent: [], transmission };
  const password = 'transmission-password-0451';
  transmission.credentials = { username: 'ann', password };
  asks(world).password = password;
  boot(world, { downloads: { offer: true } }, { ...blobFetcher(world), asks: drawing(world, splitList(kinds) as AskKind[]) });
  await k(world).kernl.downloads.add('transmission', { url: transmission.url, username: 'ann', password });
});

Then("no ask the host drew carries the program's password", (world: CoreWorld) => {
  const state = asks(world);
  expect(state.drawn.length).toBeGreaterThan(0);
  expect(JSON.stringify(state.drawn)).not.toContain(state.password);
});
