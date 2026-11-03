import { expect } from 'vitest';
import { Given, When, Then } from 'quickpickle';
import { PACKAGE_NAME } from '@kernl/guard';

interface World { name?: string }

When('I import the guard package', (world: World) => {
  world.name = PACKAGE_NAME;
});

Then('the package name is {string}', (world: World, expected: string) => {
  expect(world.name).toBe(expected);
});
void Given;
