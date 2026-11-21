import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import type { MountPlan } from '../../src/shell/contract.ts';
import { createPreviewFrame, preview, sample, type PreviewWorld } from './kernl.ts';

When('the preview kernl user grants {string} {string} for now', (world: PreviewWorld, name: string, domain: string) => {
  preview(world).kernl.grants.allowDomain(sample(name).identity, domain, { remember: false });
});

When('the preview kernl plans {string} {int} times', async (world: PreviewWorld, name: string, count: number) => {
  for (let index = 0; index < count; index += 1) await preview(world).kernl.plan(sample(name));
});

Then(/^"([^"]*)" is (still granted|no longer granted) for now in the preview kernl$/, (world: PreviewWorld, name: string, which: string) => {
  expect(preview(world).kernl.grants.get(sample(name).identity)?.temporary ?? false).toBe(which === 'still granted');
});

When('the preview kernl mounts the plan in frame {string}', (world: PreviewWorld, frameName: string) => {
  const scratch = preview(world);
  const frame = createPreviewFrame(false);
  scratch.frames.set(frameName, frame);
  scratch.handles.set(frameName, scratch.kernl.mount(scratch.plan as MountPlan, frame));
});

