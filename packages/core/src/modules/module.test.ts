import { describe, expectTypeOf, it } from 'vitest';
import { createKernl } from '../kernl.js';
import type { Kernl, KernlOptions } from '../types.js';
import type { KernlModule, ModuleApis } from './module.js';

type Clock = KernlModule<'clock', { now(): number }>;
type Plain = KernlModule<'plain'>;

// Never called: their return types are what the overloads give a caller.
const unnamed = (options: KernlOptions) => createKernl(options);
const withClock = (options: KernlOptions, clock: Clock, plain: Plain) => createKernl({ ...options, modules: [clock, plain] });

describe('the shell type follows the module list', () => {
  it('is exactly Kernl when no list is named', () => {
    expectTypeOf<ReturnType<typeof unnamed>>().toEqualTypeOf<Kernl>();
  });

  it('adds a member for each module with an api, and none for one without', () => {
    expectTypeOf<ModuleApis<[Clock, Plain]>>().toEqualTypeOf<{ readonly clock: { now(): number } }>();
    expectTypeOf<ReturnType<typeof withClock>>().toEqualTypeOf<Kernl & { readonly clock: { now(): number } }>();
    expectTypeOf<ReturnType<typeof withClock>>().not.toHaveProperty('plain');
  });
});
