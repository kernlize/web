import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { MountPlan } from '../../src/shell/contract.ts';
import { createReloader } from '../../src/shell/reload.ts';

interface ReloadScratch {
  readonly open: Map<string, MountPlan>;
  readonly planned: string[];
  readonly reloaded: Array<{ from: string; to: string }>;
  readonly problems: Array<{ title: string; body: string }>;
  readonly warnings: unknown[];
  readonly answers: Array<{ resolve(plan: MountPlan): void; reject(reason: Error): void }>;
  readonly reload: (windowId: string) => Promise<void>;
}

interface ReloadWorld {
  reload?: ReloadScratch;
}

/** Only the window id and the title are read; the rest of a plan never reaches the reloader's fakes. */
const planFor = (windowId: string, title: string): MountPlan => Object.assign(Object.create(null), { windowId, summary: { title } });

function scratchOf(world: ReloadWorld): ReloadScratch {
  if (world.reload) return world.reload;
  const open = new Map<string, MountPlan>();
  const planned: string[] = [];
  const reloaded: ReloadScratch['reloaded'] = [];
  const problems: ReloadScratch['problems'] = [];
  const warnings: unknown[] = [];
  const answers: ReloadScratch['answers'] = [];
  const reload = createReloader({
    kernl: {
      plan: (summary) => {
        planned.push(summary.title);
        return new Promise<MountPlan>((resolve, reject) => void answers.push({ resolve, reject }));
      },
    },
    windows: { get: (id) => open.get(id) && { plan: open.get(id) as MountPlan }, reload: async (from, plan) => void reloaded.push({ from, to: plan.windowId }) },
    onproblem: (title, body) => void problems.push({ title, body }),
    warn: (_message, reason) => void warnings.push(reason),
  });
  world.reload = { open, planned, reloaded, problems, warnings, answers, reload };
  return world.reload;
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
let started: Array<Promise<void>> = [];

Given('a window {string} running {string}', (world: ReloadWorld, windowId: string, title: string) => {
  scratchOf(world).open.set(windowId, planFor(windowId, title));
});

When('the person reloads {string} twice before the shell has planned it', (world: ReloadWorld, windowId: string) => {
  const scratch = scratchOf(world);
  started = [scratch.reload(windowId), scratch.reload(windowId)];
});

When('the shell plans it as {string}', async (world: ReloadWorld, next: string) => {
  const scratch = scratchOf(world);
  scratch.answers.shift()?.resolve(planFor(next, 'Notes'));
  await Promise.all(started);
});

When('the person reloads {string} and the shell plans it as {string}', async (world: ReloadWorld, windowId: string, next: string) => {
  const scratch = scratchOf(world);
  const done = scratch.reload(windowId);
  await settle();
  scratch.answers.shift()?.resolve(planFor(next, 'Notes'));
  await done;
});

When('the person reloads {string} and the shell refuses with {string}', async (world: ReloadWorld, windowId: string, reason: string) => {
  const scratch = scratchOf(world);
  const done = scratch.reload(windowId);
  await settle();
  scratch.answers.shift()?.reject(new Error(reason));
  await done;
});

When('the window {string} is closed', (world: ReloadWorld, windowId: string) => {
  scratchOf(world).open.delete(windowId);
});

Then('the window {string} was reloaded as {string}', (world: ReloadWorld, from: string, to: string) => {
  expect(scratchOf(world).reloaded.at(-1)).toEqual({ from, to });
});

Then(/^the shell planned "([^"]*)" (once|twice)$/, (world: ReloadWorld, title: string, times: string) => {
  expect(scratchOf(world).planned).toEqual(Array(times === 'once' ? 1 : 2).fill(title));
});

Then('the shell planned nothing', (world: ReloadWorld) => {
  expect(scratchOf(world).planned).toEqual([]);
});

Then('no problem was reported', (world: ReloadWorld) => {
  expect(scratchOf(world).problems).toEqual([]);
});

Then('no window was reloaded', (world: ReloadWorld) => {
  expect(scratchOf(world).reloaded).toEqual([]);
});

Then('the problem {string} says {string}', (world: ReloadWorld, title: string, body: string) => {
  expect(scratchOf(world).problems).toEqual([{ title, body }]);
});

Then('the console was warned {int} times', (world: ReloadWorld, times: number) => {
  expect(scratchOf(world).warnings).toHaveLength(times);
});
