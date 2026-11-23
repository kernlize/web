import { describe, expectTypeOf, it } from 'vitest';
import { createKernl } from '../kernl.js';
import type { Kernel, Kernl, KernlOptions } from '../types.js';
import { kernlModules } from './default.js';
import type { AnyKernlModule, KernlModule, ModuleApis } from './module.js';

type Clock = KernlModule<'clock', { now(): number }>;
type Plain = KernlModule<'plain'>;

// Never called: their return types are what the overloads give a caller.
const unnamed = (options: KernlOptions) => createKernl(options);
const withClock = (options: KernlOptions, clock: Clock, plain: Plain) => createKernl({ ...options, modules: [clock, plain] });
const withKernls = (options: KernlOptions) => createKernl({ ...options, modules: kernlModules() });

describe('the shell type follows the module list', () => {
  it('is exactly Kernl when no list is named', () => {
    expectTypeOf<ReturnType<typeof unnamed>>().toEqualTypeOf<Kernl>();
  });

  it('adds a member for each module with an api, and none for one without', () => {
    expectTypeOf<ModuleApis<[Clock, Plain]>>().toEqualTypeOf<{ readonly clock: { now(): number } }>();
    expectTypeOf<ReturnType<typeof withClock>>().toEqualTypeOf<Kernel & { readonly clock: { now(): number } }>();
    expectTypeOf<ReturnType<typeof withClock>>().not.toHaveProperty('directory');
    expectTypeOf<ReturnType<typeof withClock>>().not.toHaveProperty('plain');
  });

  it('is a Kernl again with kernl\'s own modules named', () => {
    expectTypeOf<ReturnType<typeof withKernls>>().toMatchTypeOf<Kernl>();
  });

  it('adds nothing for a list whose ids are only known as strings', () => {
    expectTypeOf<ModuleApis<AnyKernlModule[]>>().toEqualTypeOf<unknown>();
  });
});
