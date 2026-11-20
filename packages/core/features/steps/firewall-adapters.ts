import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { PermissionGrant, RuntimePermissions, TemporalDecision, TemporalPolicy } from '@kehto/runtime';
import type { DmService, OutboxPublishResult, OutboxRouter } from '@kehto/services';
import {
  acceptAnyRelay,
  createAppletAdmissions,
  createFirewall,
  createFirewallRules,
  createRuntimeRateLimiter,
  fetchThroughFirewall,
  locateSendRecipients,
  shellRelayOrigins,
  type AppletSummary,
} from '@kernlize/core';
import { createGuardConfig, type OpClass } from '@kernlize/guard';
import { MemoryStorage, scratch, splitList, type CoreWorld } from './world.js';

interface AdapterScratch {
  origins?: readonly string[];
  resolvedUnder?: 'approval' | 'request';
  router?: PublishingRouter;
  limiter?: TemporalPolicy;
  charge?: TemporalDecision;
  handed: Array<Record<string, unknown>>;
  replies: Array<Record<string, unknown>>;
  service?: DmService;
  revoked: string[];
  cleared: number;
}

function a(world: CoreWorld): AdapterScratch {
  const state = scratch(world);
  state.adapters ??= { handed: [], replies: [], revoked: [], cleared: 0 } satisfies AdapterScratch;
  return state.adapters as AdapterScratch;
}

Given('relay tiers of {string}', (world: CoreWorld, relays: string) => {
  const [first, ...rest] = splitList(relays);
  a(world).origins = shellRelayOrigins({ get: () => ({ outbox: [first as string], super: rest.slice(0, 1), discovery: rest.slice(1, 2), apps: rest.slice(2) }) });
});

Then('the shell\'s relay origins are {string}', (world: CoreWorld, origins: string) => {
  expect(a(world).origins).toEqual(splitList(origins));
});

When('a download of {string} runs {word} the firewall\'s network approval', async (world: CoreWorld, address: string, firewall: string) => {
  const request = new AbortController().signal;
  const approved = new AbortController().signal;
  const authorizeNetwork = <T>(_destination: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> => run(approved);
  const under = await fetchThroughFirewall(address, firewall === 'with' ? { signal: request, authorizeNetwork } : { signal: request }, async (signal) => (signal === approved ? 'approval' : 'request'));
  a(world).resolvedUnder = under;
});

Then(/^the download was resolved under the (firewall's approval|request's own signal)$/, (world: CoreWorld, how: string) => {
  expect(a(world).resolvedUnder).toBe(how === "firewall's approval" ? 'approval' : 'request');
});

/** The two publishes of kehto's relay-pool router; `acceptAnyRelay` touches nothing else. */
interface PublishingRouter {
  publish(): Promise<OutboxPublishResult>;
  publishWithPlan(): Promise<OutboxPublishResult>;
}

function router(result: OutboxPublishResult): PublishingRouter {
  return { publish: async () => result, publishWithPlan: async () => result };
}

Given('an outbox router whose publishes are accepted by one relay of two', (world: CoreWorld) => {
  a(world).router = router({ ok: false, error: 'partial', relays: { 'wss://a.example': true, 'wss://b.example': false } } as OutboxPublishResult);
});

Given('an outbox router whose publishes are accepted by no relay', (world: CoreWorld) => {
  a(world).router = router({ ok: false, error: 'refused', relays: { 'wss://a.example': false } } as OutboxPublishResult);
});

async function bothPublishes(world: CoreWorld): Promise<OutboxPublishResult[]> {
  const accepting = acceptAnyRelay(a(world).router as OutboxRouter) as PublishingRouter;
  return [await accepting.publish(), await accepting.publishWithPlan()];
}

Then('both its plain and its planned publish report success and keep the per-relay results', async (world: CoreWorld) => {
  for (const result of await bothPublishes(world)) expect(result).toEqual({ ok: true, relays: { 'wss://a.example': true, 'wss://b.example': false } });
});

Then('both its plain and its planned publish report failure', async (world: CoreWorld) => {
  for (const result of await bothPublishes(world)) expect(result).toMatchObject({ ok: false, error: 'refused' });
});

Then('an outbox router with no planned publish gains none', (world: CoreWorld) => {
  const { publish } = a(world).router as PublishingRouter;
  expect('publishWithPlan' in acceptAnyRelay({ publish } as OutboxRouter)).toBe(false);
});

Given('a runtime rate limiter over the {string} profile', (world: CoreWorld, profile: 'strict') => {
  a(world).limiter = createRuntimeRateLimiter(() => createGuardConfig(profile));
});

Given('a runtime rate limiter whose {string} budget flags past {int}', (world: CoreWorld, opClass: OpClass, capacity: number) => {
  const config = createGuardConfig('strict');
  const budget = { ...config.rateLimits[opClass], capacity, action: 'flag' as const };
  a(world).limiter = createRuntimeRateLimiter(() => ({ ...config, rateLimits: { ...config.rateLimits, [opClass]: budget } }));
});

function charge(world: CoreWorld, times: number, operation: string, subject: string, mode?: 'observe'): void {
  const observation = { subject, operation, lifecycle: 'life-1', elapsedSinceStartMs: 0, focused: true, now: 0 };
  for (let i = 0; i < times; i += 1) a(world).charge = mode ? a(world).limiter?.evaluate(observation, mode) : a(world).limiter?.evaluate(observation);
}

When('the runtime charges {int} {string} operations for {string}', (world: CoreWorld, times: number, operation: string, subject: string) => charge(world, times, operation, subject));

When('the runtime observes {int} {string} operations for {string}', (world: CoreWorld, times: number, operation: string, subject: string) => charge(world, times, operation, subject, 'observe'));

Then('the last charge was {word} as {string} with action {string}', (world: CoreWorld, verdict: string, reason: string, action: string) => {
  expect(a(world).charge).toMatchObject({ allowed: verdict === 'allowed', reason, action });
});

Then('retiring {string} from the runtime limiter does nothing harmful', (world: CoreWorld, subject: string) => {
  expect(() => a(world).limiter?.retire(subject, 'life-1')).not.toThrow();
});

Given('a messaging service that reads a send\'s recipients through a finder knowing {string}', (world: CoreWorld, known: string) => {
  const state = a(world);
  const service: Pick<DmService, 'handleMessage'> = { handleMessage: (_windowId, message) => void state.handed.push({ ...message }) };
  state.service = locateSendRecipients(service as DmService, {
    locate: async (input: string) => {
      if (input !== known) throw new Error('invalid:person');
      return input.replace('npub', 'hex');
    },
  } as never);
});

async function ask(world: CoreWorld, message: Record<string, unknown>): Promise<void> {
  const state = a(world);
  state.handed.length = 0;
  state.replies.length = 0;
  state.service?.handleMessage('w1', message as never, (reply) => void state.replies.push({ ...reply }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

When('an applet\'s {string} names {string}', (world: CoreWorld, type: string, recipient: string) => ask(world, { type, id: 'm1', recipients: [recipient] }));

When('an applet\'s {string} with no id names {string}', (world: CoreWorld, type: string, recipient: string) => ask(world, { type, recipients: [recipient] }));

Then('the applet was told a send with no id failed with {string}', (world: CoreWorld, error: string) => {
  expect(a(world).replies).toEqual([{ type: 'dm.send.result', id: '', error }]);
});

When('an applet\'s {string} names no recipients at all', (world: CoreWorld, type: string) => ask(world, { type }));

Then('the service underneath was handed {string} for {string}', (world: CoreWorld, type: string, recipient: string) => {
  expect(a(world).handed).toEqual([{ type, id: 'm1', recipients: [recipient] }]);
});

Then('the service underneath was handed {string} untouched', (world: CoreWorld, type: string) => {
  expect(a(world).handed).toEqual([{ type }]);
});

Then('the applet was told the send failed with {string}', (world: CoreWorld, error: string) => {
  expect(a(world).handed).toEqual([]);
  expect(a(world).replies).toEqual([{ type: 'dm.send.result', id: 'm1', error }]);
});

Given('applet admissions over a runtime without a firewall', (world: CoreWorld) => {
  const registered: string[] = [];
  scratch(world).registered = registered;
  scratch(world).admissions = createAppletAdmissions({
    sessionRegistry: { register: (windowId: string) => void registered.push(windowId), unregister: () => undefined } as never,
    destroyWindow: () => undefined,
  }, () => 0);
});

Then('admitting a window fails with {string} and opens no session', async (world: CoreWorld, reason: string) => {
  const admissions = scratch(world).admissions as ReturnType<typeof createAppletAdmissions>;
  const summary = { identity: { dTag: 'chat', hash: 'ab'.repeat(32) }, requires: [], manifest: { catalogId: 'nip5d:35129:x:chat' } } as AppletSummary;
  await expect(admissions.admit('w1', summary, { capabilities: { domains: ['shell'] }, services: [] } as never)).rejects.toThrow(reason);
  expect(scratch(world).registered).toEqual([]);
  expect(() => admissions.isCurrent('w1')).not.toThrow();
  expect(admissions.isCurrent('w1')).toBe(false);
});

const VERIFIED = { kind: 'verified', manifestKey: `nip5d:35129:${'ab'.repeat(32)}:chat`, artifactHash: 'cd'.repeat(32) } as const;

function grant(id: string, category: 'network' | 'resource', extra: Partial<PermissionGrant> = {}): PermissionGrant {
  const scope = category === 'network' ? { kind: 'origin' as const, value: 'wss://relay.example' } : { kind: 'exact' as const, value: 'https://example.com/a' };
  return { id, principal: VERIFIED, permission: { category, domain: 'relay', operation: 'relay.network', scope }, effect: 'allow', lifetime: 'session', sessionId: 's1', ...extra };
}

Given('a firewall over a grant store holding a used-once answer, a development answer, a network answer and a resource answer', (world: CoreWorld) => {
  const state = a(world);
  const grants = [
    grant('once-1', 'resource', { lifetime: 'once', requestId: 'r1' }),
    grant('dev-1', 'resource', { principal: { kind: 'development', target: 'http://localhost:5173', artifactHash: 'ef'.repeat(32) } }),
    grant('net-1', 'network'),
    grant('res-1', 'resource', { lifetime: 'persistent', effect: 'deny' }),
  ];
  const permissions: Pick<RuntimePermissions, 'grants' | 'available' | 'revoke' | 'clear' | 'subscribeInvalidation'> = {
    grants,
    available: true,
    revoke: (id) => (state.revoked.push(id), true),
    clear: () => ((state.cleared += 1), false),
    subscribeInvalidation: () => () => undefined,
  };
  scratch(world).listedFirewall = createFirewall({ rules: createFirewallRules(new MemoryStorage()), permissions: permissions as RuntimePermissions });
});

Then('the firewall lists a {string} answer and a {string} answer and nothing else', (world: CoreWorld, first: string, second: string) => {
  const firewall = scratch(world).listedFirewall as ReturnType<typeof createFirewall>;
  expect(firewall.decisions().map((decision) => [decision.id, decision.request.kind, decision.lifetime, decision.effect, decision.byRule])).toEqual([
    ['net-1', first, 'session', 'allow', false],
    ['res-1', second, 'always', 'deny', false],
  ]);
});

Then('taking an answer back and taking them all back reach the grant store', (world: CoreWorld) => {
  const firewall = scratch(world).listedFirewall as ReturnType<typeof createFirewall>;
  expect(firewall.available).toBe(true);
  expect(firewall.forget('net-1')).toBe(true);
  expect(firewall.forgetAll()).toBe(false);
  expect(a(world).revoked).toEqual(['net-1']);
  expect(a(world).cleared).toBe(1);
  firewall.close();
});
