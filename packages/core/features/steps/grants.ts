import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { createAclState, type AclStateContainer, type Capability } from '@kehto/runtime';
import {
  capabilitiesForDomain,
  capabilitiesForDomains,
  createEnvironmentResolver,
  createGrants,
  type AppletIdentity,
  type GrantRecord,
  type KernlGrants,
} from '@kernl/core';
import { attempt, scratch, splitList, type CoreWorld } from './world.js';

const HASH = 'ef'.repeat(32);

function identity(dTag: string): AppletIdentity {
  return { dTag, hash: HASH };
}

function grants(world: CoreWorld): KernlGrants {
  const value = scratch(world).grants as KernlGrants | undefined;
  if (!value) throw new Error('create grants first');
  return value;
}

function acl(world: CoreWorld): AclStateContainer {
  return scratch(world).acl as AclStateContainer;
}

function create(world: CoreWorld, available: string[]): void {
  const state = scratch(world);
  state.grantChanges = [];
  const created = createGrants({ acl: acl(world), storage: state.storage, availableDomains: () => available });
  created.changes$.subscribe((change) => (state.grantChanges as GrantRecord[]).push(change));
  state.grants = created;
  state.available = available;
}

Given('a restrictive kehto ACL state in memory', (world: CoreWorld) => {
  let persisted: string | null = null;
  scratch(world).acl = createAclState({ persist: (data) => void (persisted = data), load: () => persisted }, 'restrictive');
});

Given('the ACL already grants {string} to {string}', (world: CoreWorld, capability: Capability, dTag: string) => {
  acl(world).grant('', dTag, HASH, capability);
});

Given('kernl grants over empty storage offering {string}', (world: CoreWorld, domains: string) => {
  create(world, splitList(domains));
});

When('kernl grants are created again over the same storage', (world: CoreWorld) => {
  create(world, scratch(world).available as string[]);
});

Then('the baseline domains are {string}', (world: CoreWorld, domains: string) => {
  expect(grants(world).baselineDomains()).toEqual(splitList(domains));
});

Then('the available domains are {string}', (world: CoreWorld, domains: string) => {
  expect(grants(world).availableDomains()).toEqual(splitList(domains));
});

Then('the grants list is empty', (world: CoreWorld) => {
  expect(grants(world).list()).toEqual([]);
});

Then('the grants list names {string}', (world: CoreWorld, dTags: string) => {
  expect(grants(world).list().map((record) => record.identity.dTag)).toEqual(splitList(dTags));
});

Then('there is no grant record for {string}', (world: CoreWorld, dTag: string) => {
  expect(grants(world).get(identity(dTag))).toBeUndefined();
});

When('the shell ensures grants for {string}', (world: CoreWorld, dTag: string) => {
  grants(world).ensure(identity(dTag));
});

async function allow(world: CoreWorld, domain: string, dTag: string): Promise<void> {
  await attempt(world, () => grants(world).allowDomain(identity(dTag), domain));
}

When('the shell allows {string} for {string}', allow);

When('the shell revokes {string} for {string}', async (world: CoreWorld, domain: string, dTag: string) => {
  await attempt(world, () => grants(world).revokeDomain(identity(dTag), domain));
});

async function block(world: CoreWorld, dTag: string): Promise<void> {
  grants(world).block(identity(dTag));
}

When('the shell blocks {string}', block);

When('the shell unblocks {string}', (world: CoreWorld, dTag: string) => {
  grants(world).unblock(identity(dTag));
});

When('the shell sets the state quota for {string} to {int} bytes', (world: CoreWorld, dTag: string, bytes: number) => {
  grants(world).setStateQuota(identity(dTag), bytes);
});

Then('the grant record for {string} has domains {string} and is not blocked', (world: CoreWorld, dTag: string, domains: string) => {
  expect(grants(world).get(identity(dTag))).toMatchObject({ identity: identity(dTag), domains: splitList(domains), blocked: false });
});

Then('the grant record for {string} has domains {string} and is blocked', (world: CoreWorld, dTag: string, domains: string) => {
  expect(grants(world).get(identity(dTag))).toMatchObject({ domains: splitList(domains), blocked: true });
});

Then('the grant record for {string} has capabilities {string}', (world: CoreWorld, dTag: string, capabilities: string) => {
  expect(grants(world).get(identity(dTag))?.capabilities).toEqual(splitList(capabilities));
});

Then('the grant record for {string} has a state quota of {int} bytes', (world: CoreWorld, dTag: string, bytes: number) => {
  expect(grants(world).get(identity(dTag))?.stateQuotaBytes).toBe(bytes);
});

Then('the ACL allows {string} for {string}', (world: CoreWorld, capability: Capability, dTag: string) => {
  expect(acl(world).check('', dTag, HASH, capability)).toBe(true);
});

Then('the ACL denies {string} for {string}', (world: CoreWorld, capability: Capability, dTag: string) => {
  expect(acl(world).check('', dTag, HASH, capability)).toBe(false);
});

Then('{int} grant changes were observed', (world: CoreWorld, count: number) => {
  expect(scratch(world).grantChanges).toHaveLength(count);
});

Then('storage key {string} records {string} for {string}', (world: CoreWorld, key: string, domains: string, dTag: string) => {
  const stored = JSON.parse(scratch(world).storage.getItem(key) ?? '{}') as Record<string, { domains: string[] }>;
  expect(stored[`${dTag}:${HASH}`]?.domains).toEqual(splitList(domains));
});

Then('the resolver gives {string} domains {string} and services {string} from {string} and {string}', (world: CoreWorld, dTag: string, domains: string, services: string, availableDomains: string, availableServices: string) => {
  const resolve = createEnvironmentResolver(grants(world));
  const result = resolve({ dTag, aggregateHash: HASH }, { domains: splitList(availableDomains), services: splitList(availableServices) });
  expect(result).toEqual({ domains: splitList(domains), services: splitList(services) });
});

Then('the capabilities for domain {string} are {string}', (_world: CoreWorld, domain: string, capabilities: string) => {
  expect(capabilitiesForDomain(domain)).toEqual(splitList(capabilities));
});

Then('the capabilities for domains {string} are {string}', (_world: CoreWorld, domains: string, capabilities: string) => {
  expect(capabilitiesForDomains(splitList(domains))).toEqual(splitList(capabilities));
});
