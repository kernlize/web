import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { Subject } from 'rxjs';
import type { IntentDispatchParams } from '@kehto/services';
import { createIntentDelivery, createIntentRouter, type HandlerDefaults, type HandlerPrompt, type IntentRouter } from '@kernlize/core';
import type { NappletMessage } from '@napplet/core';
import { settle } from './kernl.js';
import { appletId, contractsOf, i, nameOf, PUB, summaryFor, titleOf, type IntentScratch } from './intent-world.js';
import { splitList, type CoreWorld } from './world.js';

// ── router ──────────────────────────────────────────────────────────────

/** Defaults the router steps steer directly: local choices, published preferences and failing saves. */
function stubDefaults(state: IntentScratch): HandlerDefaults {
  return {
    get: (archetype) => state.local.get(archetype),
    all: () => Object.fromEntries(state.local),
    async set(archetype, id) {
      if (state.failSaves) throw new Error('unavailable:storage');
      if (id) state.local.set(archetype, id);
    },
    synced: (archetype) => state.synced.get(archetype),
    load: async () => undefined,
    sync: false,
    setSync: () => undefined,
    changes$: new Subject<string>(),
  };
}

function router(world: CoreWorld): IntentRouter {
  const state = i(world);
  state.router ??= createIntentRouter({
    installed: state.installed,
    defaults: stubDefaults(state),
    choose: async (prompt) => {
      state.prompts.push(prompt);
      return state.choose ? state.choose(prompt) : undefined;
    },
    describeSender: (sender) => titleOf(nameOf(sender)),
    deliver: async (params) => void state.delivered.push(params),
  });
  return state.router;
}

Given('an intent router over installed applets {string}', (world: CoreWorld, specs: string) => {
  for (const spec of splitList(specs)) {
    const [name = '', contracts = ''] = spec.split(':');
    i(world).installed.install(summaryFor(name, contractsOf(contracts)));
  }
});

Given('the asking applet is {string}', (world: CoreWorld, name: string) => {
  i(world).sender = appletId(name);
});

Given('the shell has no chooser', (world: CoreWorld) => {
  const state = i(world);
  state.router = createIntentRouter({ installed: state.installed, defaults: stubDefaults(state), describeSender: titleOf, deliver: async () => undefined });
});

Given("the user's default for {string} is {string}", (world: CoreWorld, archetype: string, name: string) => {
  i(world).local.set(archetype, appletId(name));
});

Given('the user will pick {string}', (world: CoreWorld, name: string) => {
  i(world).choose = async () => ({ id: appletId(name), remember: false });
});

Given('the user will pick {string} and remember it', (world: CoreWorld, name: string) => {
  i(world).choose = async () => ({ id: appletId(name), remember: true });
});

Given('the user will cancel', (world: CoreWorld) => {
  i(world).choose = async () => undefined;
});

Given('the user will install {string} taking {string} and pick it', (world: CoreWorld, name: string, contracts: string) => {
  const state = i(world);
  state.choose = async () => {
    state.installed.install(summaryFor(name, contractsOf(contracts)));
    return { id: appletId(name), remember: false };
  };
});

Given('saving defaults fails', (world: CoreWorld) => {
  i(world).failSaves = true;
});

Given('the account prefers {string} for {string}', (world: CoreWorld, names: string, archetype: string) => {
  const handlers = splitList(names).map((name) => `35129:${PUB}:${name}`);
  i(world).synced.set(archetype, { archetype, handlers, intents: {} });
});

async function invoke(world: CoreWorld, convention: string, extra: Record<string, unknown> = {}): Promise<void> {
  const [, archetype = '', action = ''] = /^napplet:([^/]+)\/(.+)$/.exec(convention) ?? [];
  i(world).result = await router(world).invoke({ archetype, action, convention, ...extra }, { sender: i(world).sender });
}

When('the asking applet invokes {string}', (world: CoreWorld, convention: string) => invoke(world, convention));

When('the asking applet invokes {string} with payload {string}', (world: CoreWorld, convention: string, payload: string) => {
  const [key = '', value = ''] = payload.split('=');
  return invoke(world, convention, { payload: { [key]: value } });
});

When('the asking applet invokes {string} asking to choose', (world: CoreWorld, convention: string) => invoke(world, convention, { handler: 'choose' }));

When('the asking applet invokes {string} recommending {string}', (world: CoreWorld, convention: string, name: string) =>
  invoke(world, convention, { handlerHint: { address: `35129:${PUB}:${name}` } }),
);

When('the asking applet invokes {string} addressed to {string}', (world: CoreWorld, convention: string, name: string) => invoke(world, convention, { handler: appletId(name) }));

Then('the request went to {string}', (world: CoreWorld, name: string) => {
  expect(i(world).result).toMatchObject({ ok: true, handler: appletId(name) });
  expect(i(world).delivered.at(-1)?.handler).toBe(appletId(name));
});

Then('{string} received {string} from {string} with payload {string}', (world: CoreWorld, name: string, request: string, sender: string, payload: string) => {
  const [key = '', value = ''] = payload.split('=');
  const [archetype, action] = request.split('/');
  expect(i(world).delivered.at(-1)).toMatchObject({ handler: appletId(name), sender: appletId(sender), archetype, action, convention: `napplet:${request}`, payload: { [key]: value } });
});

Then('nobody was asked to choose', (world: CoreWorld) => {
  expect(i(world).prompts).toEqual([]);
});

Then('the request was refused with {string}', (world: CoreWorld, error: string) => {
  expect(i(world).result).toEqual({ ok: false, error });
});

Then('nothing was delivered', (world: CoreWorld) => {
  expect(i(world).delivered).toEqual([]);
});

function expectPrompt(world: CoreWorld, request: string, source: string, titles: string): HandlerPrompt {
  const prompt = i(world).prompts[0] as HandlerPrompt;
  const [archetype, action] = request.split('/');
  expect(prompt).toMatchObject({ archetype, action, convention: `napplet:${request}`, source });
  expect(prompt.options.map((option) => option.title)).toEqual(splitList(titles));
  for (const option of prompt.options) expect(option.address).toBe(`naddr-${nameOf(option.id)}`);
  return prompt;
}

Then('the user was asked about {string} from {string} with options {string} none preferred', (world: CoreWorld, request: string, source: string, titles: string) => {
  expect(expectPrompt(world, request, source, titles).options.filter((option) => option.preferred)).toEqual([]);
});

Then('the user was asked about {string} from {string} with options {string} preferred {string}', (world: CoreWorld, request: string, source: string, titles: string, preferred: string) => {
  const prompt = expectPrompt(world, request, source, titles);
  expect(prompt.options.filter((option) => option.preferred).map((option) => option.title)).toEqual(splitList(preferred));
});

Then('the chooser was shown the recommendation {string}', (world: CoreWorld, name: string) => {
  expect(i(world).prompts[0]?.recommended).toBe(`35129:${PUB}:${name}`);
});

Then('{string} cannot address {string} again without the user', async (world: CoreWorld, sender: string, name: string) => {
  i(world).sender = appletId(sender);
  await invoke(world, 'napplet:place/open', { handler: appletId(name) });
  expect(i(world).result).toEqual({ ok: false, error: 'invoke rejected' });
});

When('the asking applet asks who can take {string}', async (world: CoreWorld, archetype: string) => {
  i(world).availability = await router(world).available(archetype);
});

Then('the availability for {string} lists {string}', (world: CoreWorld, archetype: string, names: string) => {
  expect(i(world).availability).toMatchObject({ archetype, available: true, hasDefault: false });
  expect(i(world).availability?.candidates.map((candidate) => nameOf(candidate.id))).toEqual(splitList(names));
});

Then('every role the installed applets take is listed as {string}', async (world: CoreWorld, roles: string) => {
  expect((await router(world).handlers()).map((entry) => entry.archetype)).toEqual(splitList(roles));
});

When('the router announces a change to {string}', async (world: CoreWorld, archetype: string) => {
  router(world).onChanged?.((availability) => i(world).changes.push(availability));
  router(world).notifyChanged(archetype);
  await settle();
});

Then('a change to {string} was heard', (world: CoreWorld, archetype: string) => {
  expect(i(world).changes.map((change) => change.archetype)).toEqual([archetype]);
});

// ── delivery ────────────────────────────────────────────────────────────

function makeDelivery(world: CoreWorld): (params: IntentDispatchParams) => Promise<void> {
  const state = i(world);
  return createIntentDelivery({
    installed: state.installed,
    findWindow: (id) => state.running.get(id),
    openApplet: async (address) => {
      state.opened.push(address);
      return state.opensAs;
    },
    ...(state.withFocus ? { focus: (windowId: string) => void state.focused.push(windowId) } : {}),
    send: (windowId, message) => {
      const tries = (state.tries.get(windowId) ?? 0) + 1;
      state.tries.set(windowId, tries);
      if (state.never.has(windowId) || tries <= (state.readyAfter.get(windowId) ?? 0)) return false;
      state.sent.push({ windowId, message });
      return true;
    },
    retry: { intervalMs: 1, attempts: 5 },
  });
}

Given('an intent delivery over installed applets {string}', (world: CoreWorld, specs: string) => {
  for (const spec of splitList(specs)) {
    const [name = '', contracts = ''] = spec.split(':');
    i(world).installed.install(summaryFor(name, contractsOf(contracts)));
  }
});

Given('{string} is running in window {string}', (world: CoreWorld, name: string, windowId: string) => {
  i(world).running.set(appletId(name), windowId);
});

Given('a delivery without a focus hook running {string} in window {string}', (world: CoreWorld, name: string, windowId: string) => {
  i(world).withFocus = false;
  i(world).running.set(appletId(name), windowId);
});

Given('the host opens new windows as {string}', (world: CoreWorld, windowId: string) => {
  i(world).opensAs = windowId;
});

Given('the host opens nothing', (world: CoreWorld) => {
  i(world).opensAs = undefined;
});

Given('the host opens a window that never receives', (world: CoreWorld) => {
  i(world).opensAs = 'w9';
  i(world).never.add('w9');
});

Given('window {string} can receive after {int} tries', (world: CoreWorld, windowId: string, tries: number) => {
  i(world).readyAfter.set(windowId, tries);
});

function params(name: string, request: string, extra: Partial<IntentDispatchParams> = {}): IntentDispatchParams {
  const [archetype = '', action = ''] = request.split('/');
  return { handler: appletId(name), sender: appletId('notes'), archetype, action, convention: `napplet:${request}`, ...extra };
}

When('the shell delivers {string} to {string} with payload {string}', async (world: CoreWorld, request: string, name: string, payload: string) => {
  const [key = '', value = ''] = payload.split('=');
  await makeDelivery(world)(params(name, request, { payload: { [key]: value } }));
});

When('the shell delivers {string} to {string}', async (world: CoreWorld, request: string, name: string) => {
  await makeDelivery(world)(params(name, request));
});

When('the shell delivers {string} to {string} asking not to reuse', async (world: CoreWorld, request: string, name: string) => {
  await makeDelivery(world)(params(name, request, { behavior: { reuse: false } }));
});

When('the shell delivers {string} to {string} asking not to focus', async (world: CoreWorld, request: string, name: string) => {
  i(world).focused = [];
  await makeDelivery(world)(params(name, request, { behavior: { focus: false } }));
});

When('the shell delivers {string} to {string} expecting failure', async (world: CoreWorld, request: string, name: string) => {
  await makeDelivery(world)(params(name, request)).catch((error: Error) => {
    i(world).failure = error;
  });
});

function lastSent(world: CoreWorld, windowId: string): Record<string, unknown> {
  const sent = i(world).sent.filter((entry) => entry.windowId === windowId).at(-1);
  if (!sent) throw new Error(`nothing sent to ${windowId}`);
  expect(sent.message.type).toBe('intent.deliver');
  return (sent.message as NappletMessage & { delivery: Record<string, unknown> }).delivery;
}

Then('window {string} received {string} with payload {string}', (world: CoreWorld, windowId: string, request: string, payload: string) => {
  const [key = '', value = ''] = payload.split('=');
  const [archetype, action] = request.split('/');
  expect(lastSent(world, windowId)).toEqual({ sender: appletId('notes'), archetype, action, convention: `napplet:${request}`, payload: { [key]: value } });
});

Then('window {string} received {string} without a payload', (world: CoreWorld, windowId: string, request: string) => {
  const [archetype, action] = request.split('/');
  expect(lastSent(world, windowId)).toEqual({ sender: appletId('notes'), archetype, action, convention: `napplet:${request}` });
});

Then('window {string} was brought forward', (world: CoreWorld, windowId: string) => {
  expect(i(world).focused).toEqual([windowId]);
});

Then('window {string} was not brought forward', (world: CoreWorld, windowId: string) => {
  expect(i(world).focused).not.toContain(windowId);
});

Then('nothing was opened', (world: CoreWorld) => {
  expect(i(world).opened).toEqual([]);
});

Then("the host opened the viewer's address", (world: CoreWorld) => {
  expect(i(world).opened).toEqual(['naddr-viewer']);
});

Then('the delivery failed with {string}', (world: CoreWorld, reason: string) => {
  expect(i(world).failure?.message).toBe(reason);
});
