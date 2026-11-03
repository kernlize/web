import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import type { GrantRecord, Grants, RelayTier, RelayTiers, StorageLike } from '../../src/shell/contract.ts';
import { AVAILABLE_DOMAINS, baselineDomains, createPreviewGrants, createPreviewRelays, loadBaselineDomains } from '../../src/shell/preview-state.ts';

class PreviewStorage implements StorageLike {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

interface StateScratch {
  storage: PreviewStorage;
  grants?: Grants;
  relays?: RelayTiers;
  changes: GrantRecord[];
  tierChanges: number;
  error?: Error | undefined;
  baselineBefore?: readonly string[] | undefined;
  baselineLoaded?: readonly string[] | undefined;
}

interface StateWorld {
  previewState?: StateScratch;
}

const GRANTS_KEY = 'kernl:preview:grants:v1';
const RELAYS_KEY = 'kernl:preview:relays:v1';

const split = (list: string): string[] => (list === '' ? [] : list.split(',').map((part) => part.trim()));

const identityOf = (applet: string): { dTag: string; hash: string } => {
  const [dTag = '', hash = ''] = applet.split('@');
  return { dTag, hash };
};

function state(world: StateWorld): StateScratch {
  world.previewState ??= { storage: new PreviewStorage(), changes: [], tierChanges: 0 };
  return world.previewState;
}

function grants(world: StateWorld): Grants {
  const value = state(world).grants;
  if (!value) throw new Error('open the preview grants first');
  return value;
}

function relays(world: StateWorld): RelayTiers {
  const value = state(world).relays;
  if (!value) throw new Error('open the preview relays first');
  return value;
}

Given('the preview state storage holds grants {string}', (world: StateWorld, raw: string) => {
  state(world).storage.setItem(GRANTS_KEY, raw);
});

Given('the preview state storage holds relays {string}', (world: StateWorld, raw: string) => {
  state(world).storage.setItem(RELAYS_KEY, raw);
});

When('the preview state grants are opened', (world: StateWorld) => {
  const scratch = state(world);
  const opened = createPreviewGrants(scratch.storage);
  scratch.grants = opened;
  opened.changes$.subscribe((record) => scratch.changes.push(record));
});

When('the preview state allows {string} for {string}', (world: StateWorld, domain: string, applet: string) => {
  grants(world).allowDomain(identityOf(applet), domain);
});

When('the preview state revokes {string} for {string}', (world: StateWorld, domain: string, applet: string) => {
  grants(world).revokeDomain(identityOf(applet), domain);
});

When('the preview state blocks {string}', (world: StateWorld, applet: string) => {
  grants(world).block(identityOf(applet));
});

When('the preview state unblocks {string}', (world: StateWorld, applet: string) => {
  grants(world).unblock(identityOf(applet));
});

When('the preview state sets the quota of {string} to {int} bytes', (world: StateWorld, applet: string, bytes: number) => {
  grants(world).setStateQuota(identityOf(applet), bytes);
});

Then('the preview state grants {string} the domains {string}', (world: StateWorld, applet: string, domains: string) => {
  expect(grants(world).get(identityOf(applet))?.domains).toEqual(split(domains));
});

Then('the preview state shows {string} as blocked', (world: StateWorld, applet: string) => {
  expect(grants(world).get(identityOf(applet))?.blocked).toBe(true);
});

Then('the preview state shows {string} as not blocked', (world: StateWorld, applet: string) => {
  expect(grants(world).get(identityOf(applet))?.blocked).toBe(false);
});

Then('the preview state quota of {string} is {int} bytes', (world: StateWorld, applet: string, bytes: number) => {
  expect(grants(world).get(identityOf(applet))?.stateQuotaBytes).toBe(bytes);
});

Then('the preview state has no record for {string}', (world: StateWorld, applet: string) => {
  expect(grants(world).get(identityOf(applet))).toBeUndefined();
});

Then('the preview state lists the applets {string}', (world: StateWorld, applets: string) => {
  const listed = grants(world)
    .list()
    .map((record) => `${record.identity.dTag}@${record.identity.hash}`);
  expect(listed).toEqual(split(applets));
  for (const record of grants(world).list()) expect(record.capabilities).toEqual([]);
});

Then('the preview state emitted {int} grant changes', (world: StateWorld, count: number) => {
  expect(state(world).changes).toHaveLength(count);
});

Then('the preview state survives reopening with {string} granted {string}', (world: StateWorld, applet: string, domains: string) => {
  const reopened = createPreviewGrants(state(world).storage);
  expect(reopened.get(identityOf(applet))?.domains).toEqual(split(domains));
});

Then('the preview state storage no longer holds grants', (world: StateWorld) => {
  expect(state(world).storage.getItem(GRANTS_KEY)).toBeNull();
});

Then('the preview state offers every available domain', (world: StateWorld) => {
  expect(grants(world).availableDomains()).toEqual(AVAILABLE_DOMAINS);
  expect(AVAILABLE_DOMAINS).toContain('relay');
});

Given('the preview state baseline has not been loaded', (world: StateWorld) => {
  state(world).baselineBefore = baselineDomains();
});

When('the preview state baseline is loaded twice', async (world: StateWorld) => {
  const first = loadBaselineDomains();
  const second = loadBaselineDomains();
  expect(second).toBe(first);
  state(world).baselineLoaded = await first;
});

Then('the preview state baseline was empty before loading', (world: StateWorld) => {
  expect(state(world).baselineBefore).toEqual([]);
});

Then('the preview state baseline includes {string}', async (world: StateWorld, domain: string) => {
  expect(await loadBaselineDomains()).toContain(domain);
  expect(baselineDomains()).toContain(domain);
  state(world).grants ??= createPreviewGrants(state(world).storage);
  expect(grants(world).baselineDomains()).toContain(domain);
});

When('the preview state relays are opened', (world: StateWorld) => {
  const scratch = state(world);
  const opened = createPreviewRelays(scratch.storage);
  scratch.relays = opened;
  opened.changes$.subscribe(() => (scratch.tierChanges += 1));
});

When('the preview state adds {string} to the {string} relays', (world: StateWorld, url: string, tier: RelayTier) => {
  try {
    relays(world).add(tier, url);
  } catch (error) {
    state(world).error = error as Error;
  }
});

When('the preview state removes {string} from the {string} relays', (world: StateWorld, url: string, tier: RelayTier) => {
  relays(world).remove(tier, url);
});

Then('the preview state {string} relays are {string}', (world: StateWorld, tier: RelayTier, urls: string) => {
  expect(relays(world).get()[tier]).toEqual(split(urls));
});

Then('the preview state refused the relay with {string}', (world: StateWorld, reason: string) => {
  expect(state(world).error?.message).toBe(reason);
});

Then('the preview state observed the relays {int} times', (world: StateWorld, count: number) => {
  expect(state(world).tierChanges).toBe(count);
});

Then('the preview state storage holds the current relays', (world: StateWorld) => {
  expect(JSON.parse(state(world).storage.getItem(RELAYS_KEY) ?? 'null')).toEqual(relays(world).get());
});
