import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { AclStateContainer, Capability } from '@kehto/runtime';
import type { AppletMessage, KernlGrants } from '@kernlize/core';
import { k } from './kernl.js';
import { passwordSigner, scratch, type CoreWorld } from './world.js';

// The grants steps fix one artifact hash; these name a second build of the same applet.
const OTHER_HASH = '0d'.repeat(32);

function grants(world: CoreWorld): KernlGrants {
  return scratch(world).grants as KernlGrants;
}

function acl(world: CoreWorld): AclStateContainer {
  return scratch(world).acl as AclStateContainer;
}

When('the shell ensures grants for {string} built from other code', (world: CoreWorld, dTag: string) => {
  grants(world).ensure({ dTag, hash: OTHER_HASH });
});

Then('the ACL allows {string} for {string} built from other code', (world: CoreWorld, capability: Capability, dTag: string) => {
  expect(acl(world).check('', dTag, OTHER_HASH, capability)).toBe(true);
});

Then('the ACL denies {string} for {string} built from other code', (world: CoreWorld, capability: Capability, dTag: string) => {
  expect(acl(world).check('', dTag, OTHER_HASH, capability)).toBe(false);
});

Then('the grant record for {string} built from other code has domains {string}', (world: CoreWorld, dTag: string, domains: string) => {
  expect(grants(world).get({ dTag, hash: OTHER_HASH }).domains).toEqual(domains === '' ? [] : domains.split(','));
});

Given("the shell's traffic is recorded", (world: CoreWorld) => {
  const traffic: AppletMessage[] = [];
  k(world).kernl.traffic$.subscribe((message) => traffic.push(message));
  scratch(world).traffic = traffic;
});

Then('nothing the shell reported holds the signed-in key', (world: CoreWorld) => {
  const { guardEvents, record, received } = k(world);
  const reported = JSON.stringify({ guardEvents, record, received, traffic: scratch(world).traffic });
  expect((scratch(world).traffic as AppletMessage[]).length).toBeGreaterThan(0);
  expect(reported).not.toContain(Buffer.from(passwordSigner.key as Uint8Array).toString('hex'));
  expect(reported).not.toContain('nsec1');
  expect(reported).not.toContain('ncryptsec1');
});

Then("the mounted frame's sandbox is exactly {string}", (world: CoreWorld, sandbox: string) => {
  expect(k(world).frame?.attributes.get('sandbox')).toBe(sandbox);
});

Then("the mounted frame's srcdoc starts with the guard's policy", (world: CoreWorld) => {
  expect(k(world).frame?.srcdoc).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/i);
});

Then('the shell uses the supplied store, accounts and pool', (world: CoreWorld) => {
  const { kernl, supplied } = k(world);
  expect(kernl.eventStore).toBe(supplied?.eventStore);
  expect(kernl.accounts).toBe(supplied?.accounts);
  expect(kernl.pool).toBe(scratch(world).pool);
});
