import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import type { AppletHandle, AppletIdentity, AppletSummary, MountPlan, ReviewedStart } from '@kernlize/core';
import { createFakeFrame, scratch, splitList, type CoreWorld } from './world.js';
import { k } from './kernl.js';

/** Windows of the applet the scenario planned again, beside the one `a mounted applet` made. */
interface Again {
  plans: MountPlan[];
  handle?: AppletHandle;
}

function again(world: CoreWorld): Again {
  const state = scratch(world);
  return (state.again ??= { plans: [] }) as Again;
}

function identity(world: CoreWorld): AppletIdentity {
  const found = k(world).summary?.identity;
  if (!found) throw new Error('mount an applet first');
  return found;
}

When('the user grants the mounted applet {string} for now', (world: CoreWorld, domain: string) => {
  k(world).kernl.grants.allowDomain(identity(world), domain, { remember: false });
});

When('the shell plans the applet again', async (world: CoreWorld) => {
  again(world).plans.push(await k(world).kernl.plan(k(world).summary as AppletSummary));
});

When('the shell plans the applet {int} more times', async (world: CoreWorld, count: number) => {
  for (let index = 0; index < count; index += 1) again(world).plans.push(await k(world).kernl.plan(k(world).summary as AppletSummary));
});

When('the shell mounts the applet planned again', (world: CoreWorld) => {
  const state = again(world);
  state.handle = k(world).kernl.mount(state.plans[0] as MountPlan, createFakeFrame());
});

When('the shell closes the applet planned again', (world: CoreWorld) => {
  again(world).handle?.close();
});

Then('mounting the first of those plans is refused with {string}', (world: CoreWorld, reason: string) => {
  expect(() => k(world).kernl.mount(again(world).plans[0] as MountPlan, createFakeFrame())).toThrow(reason);
});

Then(/^the mounted applet is (granted for now|not granted for now)$/, (world: CoreWorld, which: string) => {
  expect(k(world).kernl.grants.get(identity(world))?.temporary).toBe(which === 'granted for now');
});

Then('the mounted applet\'s stored grants are {string}', (world: CoreWorld, domains: string) => {
  expect(k(world).kernl.grants.get(identity(world))?.domains).toEqual(splitList(domains));
});

async function replaceReviewed(world: CoreWorld, domain: string, fail: boolean): Promise<void> {
  const { kernl, summary } = k(world);
  const replace = async (start: ReviewedStart): Promise<void> => {
    kernl.grants.revokeDomain(summary!.identity, domain, { remember: false });
    expect(kernl.applets()).toHaveLength(0);
    expect(kernl.grants.get(summary!.identity)?.domains).not.toContain(domain);
    const plan = await start.plan();
    if (fail) throw new Error('unavailable:replacement');
    again(world).plans.push(plan);
    again(world).handle = kernl.mount(plan, createFakeFrame());
  };
  await kernl.withGrantReview(summary!, replace);
}

When('the shell replaces it under a review withdrawing {string} for now', (world: CoreWorld, domain: string) => replaceReviewed(world, domain, false));

When('the reviewed replacement withdrawing {string} fails to open', async (world: CoreWorld, domain: string) => {
  await expect(replaceReviewed(world, domain, true)).rejects.toThrow('unavailable:replacement');
});

Then('the replacement started without {string}', (world: CoreWorld, domain: string) => {
  expect(again(world).plans[0]?.environment.capabilities.domains).not.toContain(domain);
});

When('the shell reviews its existing plan before and after widening its grants', async (world: CoreWorld) => {
  const { kernl, summary, plan } = k(world);
  await kernl.withGrantReview(summary!, async (review) => {
    const before = review.canReuse(plan!);
    kernl.grants.allowDomain(summary!.identity, 'notify');
    scratch(world).reuse = [before, review.canReuse(plan!)];
    expect(review.canReuse(await review.plan())).toBe(false);
    await kernl.withGrantReview(summary!, async () => undefined);
  });
});

Then('the old plan can be reused before the change but not after', (world: CoreWorld) => {
  expect(scratch(world).reuse).toEqual([true, false]);
});

When('the reviewed applet fails to build its mount plan', async (world: CoreWorld) => {
  const { kernl, summary } = k(world);
  await expect(kernl.withGrantReview(summary!, async (start) => {
    kernl.grants.allowDomain(summary!.identity, 'notify', { remember: false });
    await start.plan();
  })).rejects.toThrow('denied:nested-frame');
});
