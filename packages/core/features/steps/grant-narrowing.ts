import { expect } from 'vitest';
import { Then, When } from 'quickpickle';
import type { AppletIdentity } from '@kernlize/core';
import { k } from './kernl.js';
import type { CoreWorld } from './world.js';

/** The user changing a running applet's grant (D-038). */
function mountedIdentity(world: CoreWorld): AppletIdentity {
  const identity = k(world).summary?.identity;
  if (!identity) throw new Error('mount an applet first');
  return identity;
}

When('the user also grants the mounted applet {string}', (world: CoreWorld, domain: string) => {
  k(world).kernl.grants.allowDomain(mountedIdentity(world), domain);
});

When('the user takes back {string} from the mounted applet', (world: CoreWorld, domain: string) => {
  k(world).kernl.grants.revokeDomain(mountedIdentity(world), domain);
});

When('the user blocks the mounted applet', (world: CoreWorld) => {
  k(world).kernl.grants.block(mountedIdentity(world));
});

When('the user blocks another applet', (world: CoreWorld) => {
  const identity = mountedIdentity(world);
  k(world).kernl.grants.block({ dTag: identity.dTag, hash: 'f'.repeat(64) });
});

Then('the host was told of no revocation', (world: CoreWorld) => {
  expect(k(world).record.revoked).toEqual([]);
});
