import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { ShellAdapter, ShellEnvironment } from '@kehto/shell';
import type { GuardProfile, WindowVisibility } from '@kernl/guard';
import { AccountManager } from 'applesauce-accounts';
import { createRelayTiers, createShellAdapter, mountApplet, planMount, resolveApplet, type AppletStatus, type AppletSummary, type MountDeps, type MountPlan, type MountedApplet } from '@kernl/core';
import { attempt, createFakeFrame, scratch, signManifest, splitList, type CoreWorld, type FakeFrame } from './world.js';

interface MountRecord {
  steps: string[];
  revocations: Array<{ windowId: string; reason: string | undefined }>;
  unregistered: string[];
  forgotten: string[];
  visibility: Array<{ windowId: string; visibility: WindowVisibility }>;
  hostRevocations: Array<{ windowId: string; reason: string }>;
  statuses: AppletStatus[];
}

function record(world: CoreWorld): MountRecord {
  const state = scratch(world);
  state.mountRecord ??= { steps: [], revocations: [], unregistered: [], forgotten: [], visibility: [], hostRevocations: [], statuses: [] };
  return state.mountRecord as MountRecord;
}

/** kernl's real adapter over fakes, narrowing every applet to the allowed domains. */
function fakeAdapter(world: CoreWorld, allowed: string[]): ShellAdapter {
  const state = scratch(world);
  return createShellAdapter({
    pool: state.pool,
    tiers: createRelayTiers(state.storage),
    accounts: new AccountManager(),
    services: {},
    resolveEnvironment: (_identity, available) => ({
      domains: available.domains.filter((domain) => allowed.includes(domain)),
      services: available.services.filter((service) => allowed.includes(service)),
    }),
    onNappletRevoked: () => undefined,
    onNappletMessage: () => undefined,
  });
}

function deps(world: CoreWorld): MountDeps {
  const log = record(world);
  return {
    bridge: {
      observeFrame: (_frame, windowId) => {
        log.steps.push('observeFrame');
        return () => void log.steps.push(`stop:${windowId}`);
      },
      revokeNapplet: (windowId, reason) => void log.revocations.push({ windowId, reason }),
    },
    originRegistry: {
      register: () => void log.steps.push('register'),
      setEnvironment: () => void log.steps.push('setEnvironment'),
      unregister: (windowId) => void log.unregistered.push(windowId),
    },
    guard: {
      setVisibility: (windowId, visibility) => void log.visibility.push({ windowId, visibility }),
      forget: (windowId) => void log.forgotten.push(windowId),
    },
    onRevoked: (windowId, reason) => void log.hostRevocations.push({ windowId, reason }),
  };
}

function plan(world: CoreWorld): MountPlan {
  const value = scratch(world).plan as MountPlan | undefined;
  if (!value) throw new Error('plan first');
  return value;
}

function frame(world: CoreWorld): FakeFrame {
  return scratch(world).frame as FakeFrame;
}

function handle(world: CoreWorld): MountedApplet {
  const value = scratch(world).handle as MountedApplet | undefined;
  if (!value) throw new Error('mount first');
  return value;
}

Given('a verified applet summary for {string} requiring {string}', async (world: CoreWorld, dTag: string, requires: string) => {
  const manifest = await signManifest({ dTag, requires: splitList(requires) });
  const resolved = await resolveApplet({ event: manifest.event, fetchBlob: async () => new TextEncoder().encode(manifest.html) });
  scratch(world).manifest = manifest;
  scratch(world).summary = resolved.summary;
  scratch(world).indexHtml = resolved.indexHtml;
});

Given('a shell adapter whose resolver allows {string}', (world: CoreWorld, allowed: string) => {
  scratch(world).adapter = fakeAdapter(world, splitList(allowed));
});

function makePlan(world: CoreWorld, windowId: string, guardProfile: GuardProfile): void {
  const state = scratch(world);
  state.plan = planMount({
    summary: state.summary as AppletSummary,
    indexHtml: state.indexHtml as string,
    adapter: state.adapter as ShellAdapter,
    guardProfile,
    windowId,
  });
}

When('the shell plans the mount in window {string} under the {string} profile', (world: CoreWorld, windowId: string, profile: GuardProfile) => {
  makePlan(world, windowId, profile);
});

Given('a plan for window {string}', (world: CoreWorld, windowId: string) => {
  makePlan(world, windowId, 'strict');
});

Then('the plan is for window {string} with sandbox {string}', (world: CoreWorld, windowId: string, sandbox: string) => {
  expect(plan(world).windowId).toBe(windowId);
  expect(plan(world).sandbox).toBe(sandbox);
  expect(plan(world).summary).toBe(scratch(world).summary);
});

Then('the plan environment domains are {string}', (world: CoreWorld, domains: string) => {
  const environment: ShellEnvironment = plan(world).environment;
  expect([...environment.capabilities.domains].sort()).toEqual(splitList(domains).sort());
});

Then('the plan is missing required domains {string}', (world: CoreWorld, domains: string) => {
  expect(plan(world).missingRequired).toEqual(splitList(domains));
});

Then('the plan srcdoc starts with the CSP meta and contains the namespace prelude and the verified html', (world: CoreWorld) => {
  const { srcdoc } = plan(world);
  expect(srcdoc.indexOf('Content-Security-Policy')).toBeGreaterThan(-1);
  expect(srcdoc).toContain("connect-src 'none'");
  expect(srcdoc).toContain('window.napplet');
  expect(srcdoc).toContain('<body>hi</body>');
  expect(srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(srcdoc.indexOf('window.napplet'));
});

Given('a fake frame', (world: CoreWorld) => {
  scratch(world).frame = createFakeFrame();
});

Given('a fake frame with a string sandbox, a getAttribute and allow {string}', (world: CoreWorld, allow: string) => {
  const created = createFakeFrame({ stringSandbox: true, withGetAttribute: true });
  created.attributes.set('allow', allow);
  scratch(world).frame = created;
});

Given('a detached fake frame', (world: CoreWorld) => {
  scratch(world).frame = createFakeFrame({ detached: true });
});

async function mount(world: CoreWorld): Promise<void> {
  const target = frame(world);
  const log = record(world);
  const originalAdd = target.sandbox;
  if (typeof originalAdd !== 'string') {
    target.sandbox = {
      add: (token) => {
        log.steps.push('sandbox');
        originalAdd.add(token);
      },
    };
  }
  await attempt(world, () => {
    const mounted = mountApplet(plan(world), target, deps(world));
    scratch(world).handle = mounted;
    mounted.status$.subscribe((status) => log.statuses.push(status));
  });
  if (typeof target.sandbox === 'string') log.steps.unshift('sandbox');
}

When('the shell mounts the plan into the frame', mount);

Then('the mount steps were {string}', (world: CoreWorld, steps: string) => {
  const observed = record(world).steps;
  const srcdocAt = frame(world).srcdoc ? observed.length : -1;
  expect([...observed.slice(0, srcdocAt), 'srcdoc']).toEqual(splitList(steps));
});

Then('the frame sandbox tokens are {string}', (world: CoreWorld, tokens: string) => {
  expect([...frame(world).tokens]).toEqual(splitList(tokens));
});

Then('the frame sandbox string is {string}', (world: CoreWorld, value: string) => {
  expect(frame(world).sandbox).toBe(value);
});

Then('the frame allow attribute is {string}', (world: CoreWorld, value: string) => {
  expect(frame(world).attributes.get('allow')).toBe(value);
});

Then('the frame srcdoc is the plan srcdoc', (world: CoreWorld) => {
  expect(frame(world).srcdoc).toBe(plan(world).srcdoc);
});

Then('the applet status is {string}', (world: CoreWorld, status: string) => {
  expect(handle(world).status).toBe(status);
});

Then('the observed statuses are {string}', (world: CoreWorld, statuses: string) => {
  expect(record(world).statuses).toEqual(splitList(statuses));
});

When('the frame fires its load event', (world: CoreWorld) => {
  frame(world).fireLoad();
});

Then('the frame has {int} load listeners', (world: CoreWorld, count: number) => {
  expect(frame(world).listeners.get('load') ?? []).toHaveLength(count);
});

When('the shell closes the applet', (world: CoreWorld) => {
  handle(world).close();
});

When('the bridge reports the applet revoked for {string}', (world: CoreWorld, reason: string) => {
  handle(world).revoked(reason);
});

When('the shell marks the applet hidden', (world: CoreWorld) => {
  handle(world).setVisibility({ visible: false, focused: false });
});

Then('the bridge revoked {string} with reason {string}', (world: CoreWorld, windowId: string, reason: string) => {
  expect(record(world).revocations).toEqual([{ windowId, reason }]);
});

Then('the bridge revoked {int} times', (world: CoreWorld, count: number) => {
  expect(record(world).revocations).toHaveLength(count);
});

Then('the registry unregistered {string}', (world: CoreWorld, windowId: string) => {
  expect(record(world).unregistered).toEqual([windowId]);
});

Then('the frame was removed', (world: CoreWorld) => {
  expect(frame(world).removed).toBe(true);
});

Then('the guard forgot {string}', (world: CoreWorld, windowId: string) => {
  expect(record(world).forgotten).toEqual([windowId]);
});

Then('the host was told {string} was revoked for {string}', (world: CoreWorld, windowId: string, reason: string) => {
  expect(record(world).hostRevocations).toEqual([{ windowId, reason }]);
});

Then('the host was not told about a revocation', (world: CoreWorld) => {
  expect(record(world).hostRevocations).toEqual([]);
});

Then('the guard saw {string} become hidden', (world: CoreWorld, windowId: string) => {
  expect(record(world).visibility).toEqual([{ windowId, visibility: { visible: false, focused: false } }]);
});
