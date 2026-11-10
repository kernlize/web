import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import { frameOf, preview, type PreviewWorld } from './kernl.ts';

Then('the preview kernl host showed the settings for {string} with fields {string}', (world: PreviewWorld, title: string, fields: string) => {
  const prompt = preview(world).settings.at(-1);
  expect(prompt?.title).toBe(title);
  expect(Object.keys(prompt?.context.schema.properties ?? {}).join(',')).toBe(fields);
});

Then('the preview kernl host showed the settings form {int} time(s)', (world: PreviewWorld, count: number) => {
  expect(preview(world).settings).toHaveLength(count);
});

When('the person commits {string} in the preview settings form', (world: PreviewWorld, values: string) => {
  const prompt = preview(world).settings.at(-1);
  if (!prompt) throw new Error('no settings form was shown');
  prompt.context.commit({ ...prompt.context.values, ...(JSON.parse(values) as Record<string, unknown>) });
});

Then('the preview kernl frame {string} was never sent {string}', (world: PreviewWorld, name: string, secret: string) => {
  expect(JSON.stringify(frameOf(preview(world), name).posts)).not.toContain(secret);
});
