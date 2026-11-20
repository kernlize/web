import { expect, vi } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createPermissionRules, type PermissionRequirement, type PermissionRules } from '@kehto/firewall';
import type { ApprovalAnswer, ApprovalPrompt } from '@kehto/runtime';
import {
  answerFor,
  createFirewallPermissions,
  createFirewallRules,
  createRuntimeRateLimiter,
  defaultFirewallRules,
  describeApproval,
  type AppletSummary,
  type FirewallChoice,
  type FirewallDecision,
  type FirewallPrompt,
  type FirewallRuleTarget,
  type FirewallRules,
  type FirewallSummary,
  type MountPlan,
} from '@kernlize/core';
import { createGuardConfig } from '@kernlize/guard';
import { blobFetcher, boot, hello, k, mountFrame, settle, vector } from './kernl.js';
import { attempt, scratch, splitList, type CoreWorld } from './world.js';

interface FirewallScratch {
  questions: FirewallPrompt[];
  opened: Array<{ url: string; approved: boolean }>;
  told: Array<readonly FirewallDecision[]>;
  planning?: Promise<MountPlan>;
  plans: MountPlan[];
  rules?: FirewallRules;
  summary?: FirewallSummary;
  cancelled?: ApprovalAnswer;
}

function fw(world: CoreWorld): FirewallScratch {
  const state = scratch(world);
  state.firewall ??= { questions: [], opened: [], told: [], plans: [] } satisfies FirewallScratch;
  return state.firewall as FirewallScratch;
}

function question(world: CoreWorld): FirewallPrompt {
  const last = fw(world).questions.at(-1);
  if (!last) throw new Error('no firewall question was asked');
  return last;
}

function decisions(world: CoreWorld): readonly FirewallDecision[] {
  return k(world).kernl.firewall.decisions();
}

Given('a kernl shell whose host answers firewall questions', (world: CoreWorld) => {
  const state = fw(world);
  boot(world, {}, {
    ...blobFetcher(world),
    presentApproval: (prompt) => void state.questions.push(prompt),
    openLink: (url, options) => void state.opened.push({ url, approved: options?.approved === true }),
  });
  k(world).kernl.firewall.decisions$.subscribe((list) => state.told.push(list));
});

Then('the shipped firewall rules allow by default and ask about {string} only', (_world: CoreWorld, operation: string) => {
  const rules = defaultFirewallRules();
  expect(rules.default).toBe('allow');
  expect(rules.operations).toEqual({ [operation]: 'ask' });
  expect(rules.domains).toEqual({});
  expect(rules.napplets).toEqual({});
});

Then('the shipped firewall rules are in force', (world: CoreWorld) => {
  expect(k(world).kernl.firewall.rules()).toEqual(defaultFirewallRules());
});

Given('the firewall rule for {string} is set to {string}', async (world: CoreWorld, target: string, action: 'allow' | 'ask' | 'deny') => {
  k(world).kernl.firewall.setRule(JSON.parse(target) as FirewallRuleTarget, action);
  await settle();
});

When('the firewall rule for {string} is removed', (world: CoreWorld, target: string) => {
  k(world).kernl.firewall.setRule(JSON.parse(target) as FirewallRuleTarget, undefined);
});

Then('the firewall rule for domain {string} is {string}', (world: CoreWorld, domain: string, action: string) => {
  const seen: PermissionRules[] = [];
  k(world).kernl.firewall.rules$.subscribe((rules) => seen.push(rules)).unsubscribe();
  expect(seen.at(-1)?.domains[domain]).toBe(action);
});

Then('setting the firewall rule for {string} fails with {string}', (world: CoreWorld, target: string, reason: string) => {
  expect(() => k(world).kernl.firewall.setRule(JSON.parse(target) as FirewallRuleTarget, 'ask')).toThrow(reason);
});

When('the firewall rules are restored', async (world: CoreWorld) => {
  k(world).kernl.firewall.restoreDefaults();
  await settle();
});

Then('the host was asked {int} firewall questions', (world: CoreWorld, count: number) => {
  expect(fw(world).questions).toHaveLength(count);
});

Then('the host was asked a {string} firewall question by {string} with choices {string}', (world: CoreWorld, kind: string, title: string, choices: string) => {
  const { summary } = question(world);
  expect(summary.kind).toBe(kind);
  expect(summary.choices).toEqual(splitList(choices));
  expect(summary.applet).toEqual({ title, catalogId: k(world).summary?.manifest.catalogId, identity: k(world).summary?.identity });
});

Then('the firewall question is about {string} of {string} in domain {string}', (world: CoreWorld, operation: string, target: string, domain: string) => {
  expect(question(world).summary.requests).toContainEqual(expect.objectContaining({ operation, target, domain }));
});

When('the person answers the firewall question with {string}', async (world: CoreWorld, answer: string) => {
  question(world).resolve(answer === 'dismiss' ? undefined : (answer as FirewallChoice));
  await settle();
});

Then('the firewall question was withdrawn', (world: CoreWorld) => {
  expect(question(world).signal.aborted).toBe(true);
});

When('the applet asks to open link {int} at {string}', async (world: CoreWorld, n: number, url: string) => {
  k(world).channel?.port1.postMessage({ type: 'link.open', id: `link-${n}`, url });
  await settle();
});

Then('link {int} was {string}', (world: CoreWorld, n: number, status: string) => {
  expect(k(world).received.find((entry) => entry.id === `link-${n}`)).toMatchObject({ type: 'link.open.result', status });
});

Then('the host opened no links', (world: CoreWorld) => {
  expect(fw(world).opened).toEqual([]);
});

Then('the host opened {string} as already approved', (world: CoreWorld, url: string) => {
  expect(fw(world).opened.at(-1)).toEqual({ url, approved: true });
});

Then('the firewall holds a rule-given {string} answer for domain {string}', (world: CoreWorld, kind: string, domain: string) => {
  expect(decisions(world)).toContainEqual(expect.objectContaining({ byRule: true, effect: 'allow', lifetime: 'session', hash: k(world).summary?.identity.hash, request: expect.objectContaining({ kind, domain }) }));
});

Then('the firewall holds no rule-given answer for domain {string}', (world: CoreWorld, domain: string) => {
  expect(decisions(world).filter((decision) => decision.byRule && decision.request.domain === domain)).toEqual([]);
});

Then('the firewall holds no answers the person gave', (world: CoreWorld) => {
  expect(decisions(world).filter((decision) => !decision.byRule)).toEqual([]);
});

Then(/^the firewall is (not )?available$/, (world: CoreWorld, not: string | null | undefined) => {
  expect(k(world).kernl.firewall.available).toBe(!not);
});

Then('the firewall holds no answers at all', (world: CoreWorld) => {
  expect(decisions(world)).toEqual([]);
});

Then('the firewall holds a(n) {string} answer the person gave for domain {string}', (world: CoreWorld, lifetime: string, domain: string) => {
  const given = decisions(world).filter((decision) => !decision.byRule);
  expect(given).toEqual([expect.objectContaining({ lifetime, effect: 'allow', catalogId: k(world).summary?.manifest.catalogId, request: { kind: 'access', domain, operation: 'access', target: domain } })]);
});

Then('the firewall told its listeners of an answer the person gave', async (world: CoreWorld) => {
  await vi.waitFor(() => expect(fw(world).told.at(-1)?.some((decision) => !decision.byRule)).toBe(true));
});

Then('the host storage holds the firewall\'s answers under {string}', (world: CoreWorld, key: string) => {
  const stored = JSON.parse(scratch(world).storage.getItem(key) ?? '{}') as { grants?: unknown[] };
  expect(stored.grants).toHaveLength(1);
});

When('the person takes the first of their answers back', async (world: CoreWorld) => {
  const [first] = decisions(world).filter((decision) => !decision.byRule);
  k(world).kernl.firewall.forget(first?.id ?? '');
  await settle();
});

Then('the host was told window {string} was revoked for {string} and no other', (world: CoreWorld, windowId: string, reason: string) => {
  expect(k(world).record.revoked).toEqual([{ windowId, reason }]);
});

When('the person takes that answer back', async (world: CoreWorld) => {
  const [given] = decisions(world).filter((decision) => !decision.byRule);
  expect(k(world).kernl.firewall.forget(given?.id ?? '')).toBe(true);
  await settle();
});

When('the person takes every firewall answer back', async (world: CoreWorld) => {
  expect(k(world).kernl.firewall.forgetAll()).toBe(true);
  await settle();
});

Given('the applet is resolved and granted {string}', async (world: CoreWorld, domain: string) => {
  const { kernl } = k(world);
  const summary = await kernl.resolve(kernl.decodePointer(`${vector(world).pubkey}:35129:chat`));
  k(world).summary = summary;
  kernl.grants.allowDomain(summary.identity, domain);
});

When('the shell starts planning the applet', async (world: CoreWorld) => {
  const planning = k(world).kernl.plan(k(world).summary as AppletSummary);
  planning.catch(() => undefined);
  fw(world).planning = planning;
  await settle();
});

Then('the plan is ready and offers {string}', async (world: CoreWorld, domain: string) => {
  k(world).plan = await fw(world).planning;
  expect(k(world).plan?.environment.capabilities.domains).toContain(domain);
  expect(k(world).plan?.srcdoc).toContain(domain);
});

Then('the plan does not offer {string}', (world: CoreWorld, domain: string) => {
  expect(k(world).plan?.environment.capabilities.domains).not.toContain(domain);
});

When('the plan is mounted', async (world: CoreWorld) => {
  k(world).plan = await fw(world).planning;
  mountFrame(world);
  k(world).channel = hello(world, k(world).frame?.contentWindow as Window);
  await settle();
});

Then('planning failed with {string}', async (world: CoreWorld, reason: string) => {
  await expect(fw(world).planning).rejects.toThrow(reason);
});

Then('the shell runtime holds no session for the planned window', (world: CoreWorld) => {
  expect(k(world).kernl.bridge.runtime.sessionRegistry.getAllEntries()).toEqual([]);
});

Then('mounting the plan fails with {string}', (world: CoreWorld, reason: string) => {
  expect(() => mountFrame(world)).toThrow(reason);
});

When('the shell plans the applet {int} times without mounting', async (world: CoreWorld, times: number) => {
  for (let i = 0; i < times; i += 1) fw(world).plans.push(await k(world).kernl.plan(k(world).summary as AppletSummary));
});

Then('mounting the first of those plans fails with {string}', (world: CoreWorld, reason: string) => {
  k(world).plan = fw(world).plans[0] as MountPlan;
  expect(() => mountFrame(world)).toThrow(reason);
});

Then('mounting the last of those plans works', (world: CoreWorld) => {
  k(world).plan = fw(world).plans.at(-1) as MountPlan;
  mountFrame(world);
  expect(k(world).kernl.applets()).toHaveLength(1);
});

Then('the host was told {string}', (world: CoreWorld, title: string) => {
  expect(k(world).record.notices).toContainEqual(expect.objectContaining({ title, tone: 'warning' }));
});

Given('firewall rules over the host storage with {string}', (world: CoreWorld, init: string) => {
  const { storage } = scratch(world);
  const rules = createFirewallRules(storage);
  const wanted = createPermissionRules(JSON.parse(init) as Partial<PermissionRules>);
  rules.set({}, wanted.default);
  rules.set({ operation: 'link.open' }, undefined);
  for (const [domain, action] of Object.entries(wanted.domains)) rules.set({ domain }, action);
  for (const [operation, action] of Object.entries(wanted.operations)) rules.set({ operation }, action);
  fw(world).rules = rules;
});

const PRINCIPAL = { kind: 'verified', manifestKey: `nip5d:35129:${'ab'.repeat(32)}:chat`, artifactHash: 'cd'.repeat(32) } as const;

function requirement(category: string, domain: string, operation: string): PermissionRequirement {
  const scope = category === 'network' ? { kind: 'origin' as const, value: 'wss://relay.example' } : { kind: 'exact' as const, value: category === 'interface' ? domain : 'https://example.com/a' };
  return { category: category as PermissionRequirement['category'], domain, operation, scope };
}

Then('those rules decide {string} for a {string} request in domain {string} alongside access to {string}', (world: CoreWorld, decision: string, operation: string, domain: string, access: string) => {
  const rules = fw(world).rules as FirewallRules;
  expect(rules.decide({ principal: PRINCIPAL }, [requirement('interface', access, 'access'), requirement('resource', domain, operation)])).toBe(decision);
});

When('kehto asks about {string} in domain {string} as a {string} request, allowing {string}', (world: CoreWorld, operation: string, domain: string, category: string, lifetimes: string) => {
  const prompt = { missing: [requirement(category, domain, operation)], allowLifetimes: splitList(lifetimes) as ApprovalPrompt['allowLifetimes'] };
  fw(world).summary = describeApproval(prompt, { title: 'Chat', catalogId: PRINCIPAL.manifestKey, identity: { dTag: 'chat', hash: PRINCIPAL.artifactHash } });
});

Then('the firewall summary is a {string} with choices {string}', (world: CoreWorld, kind: string, choices: string) => {
  expect(fw(world).summary?.kind).toBe(kind);
  expect(fw(world).summary?.choices).toEqual(splitList(choices));
});

Then('the answer for {string} is {string}', (world: CoreWorld, choice: string, answer: string) => {
  const given = answerFor(fw(world).summary as FirewallSummary, choice === 'dismiss' ? undefined : (choice as FirewallChoice));
  expect(given.effect === 'cancel' ? 'cancel' : `${given.effect} ${given.lifetime}`).toBe(answer);
});

When('kehto\'s firewall adapter is asked about an applet nobody planned', async (world: CoreWorld) => {
  const { storage } = scratch(world);
  const permissions = createFirewallPermissions({
    host: { storage, notify: () => undefined, presentApproval: (prompt) => void fw(world).questions.push(prompt) },
    rules: createFirewallRules(storage),
    appletOf: () => undefined,
    rateLimiter: createRuntimeRateLimiter(() => createGuardConfig('strict')),
    onRateLimit: () => undefined,
  });
  const cancel = permissions.createCancellation();
  await attempt(world, async () => {
    fw(world).cancelled = await permissions.prompt?.({
      request: { principal: PRINCIPAL, sessionId: 's1', requestId: 'r1', requirements: [] },
      missing: [requirement('resource', 'link', 'link.open')],
      signal: cancel.signal,
      allowLifetimes: ['once'],
    });
  });
  permissions.schedule(() => undefined, 1)();
  expect(permissions.now()).toBeTypeOf('number');
});

Then('that question was cancelled without the host being asked', (world: CoreWorld) => {
  expect(fw(world).cancelled).toEqual({ effect: 'cancel' });
  expect(fw(world).questions).toEqual([]);
});
