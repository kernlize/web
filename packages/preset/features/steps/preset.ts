import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import { kernlPreset } from '@kernlize/preset';

interface PresetWorld {
  preset?: ReturnType<typeof kernlPreset>;
}

When("a host asks for kernl's preset", (world: PresetWorld) => {
  world.preset = kernlPreset();
});

Then('the preset names the modules {string}', (world: PresetWorld, ids: string) => {
  expect(world.preset?.map((module) => module.id)).toEqual(ids.split(', '));
});
