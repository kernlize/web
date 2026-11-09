import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import {
  createMailBridge,
  createNzbBridge,
  createSoulseekBridge,
  createTorrentBridge,
  parseLocator,
  type Bridge,
} from '@kernlize/bridges';
import { capture, expectReason, splitList, type BridgeWorld } from './world';

const WITHOUT_BACKEND: Record<string, () => Bridge> = {
  torrent: () => createTorrentBridge(),
  nzb: () => createNzbBridge(),
  soulseek: () => createSoulseekBridge(),
  mail: () => createMailBridge(),
};

function withBackend(world: BridgeWorld, kind: string): Bridge {
  const calls: unknown[][] = [];
  world.backendCalls = calls;
  const job = { id: 'job-1', name: '' };
  const record =
    <T>(value: (first: string) => T) =>
    (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(value(String(args[0])));
    };
  const named = (name: (first: string) => string) => record((first) => ({ ...job, name: name(first) }));
  const last = (text: string) => text.split('/').at(-1) ?? '';
  switch (kind) {
    case 'torrent':
      return createTorrentBridge({ add: record(() => ({ ...job, name: 'Mix' })) });
    case 'nzb':
      return createNzbBridge({ add: named(last) });
    case 'soulseek':
      return createSoulseekBridge({
        download: (user, path, context) => named(() => last(path))(user, path, context),
      });
    default:
      return createMailBridge({ open: record(() => ({ id: 'conv-1' })) });
  }
}

function bridge(world: BridgeWorld): Bridge {
  if (!world.bridge) throw new Error('no bridge');
  return world.bridge;
}

function asText(value: unknown): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

Given('the {word} bridge without a backend', (world: BridgeWorld, kind: string) => {
  const make = WITHOUT_BACKEND[kind];
  if (!make) throw new Error(`unknown bridge kind ${kind}`);
  world.bridge = make();
});

Given('the {word} bridge with a fake backend', (world: BridgeWorld, kind: string) => {
  world.bridge = withBackend(world, kind);
});

Then(
  'the bridge has id {string}, label {string} and serves {string}',
  (world: BridgeWorld, id: string, label: string, scheme: string) => {
    expect(bridge(world)).toMatchObject({ id, label, schemes: [scheme] });
  },
);

Then('the bridge is unavailable because {string}', (world: BridgeWorld, reason: string) => {
  expect(bridge(world).availability()).toEqual({ available: false, reason });
});

Then('the bridge is available', (world: BridgeWorld) => {
  expect(bridge(world).availability()).toEqual({ available: true });
});

Then(
  'the bridge exposure is address {word}, encrypted {word}, public {word}',
  (world: BridgeWorld, address: string, encrypted: string, publicActivity: string) => {
    expect(bridge(world).exposure).toEqual({
      revealsAddress: address === 'yes',
      encryptedInTransit: encrypted === 'yes',
      publicActivity: publicActivity === 'yes',
    });
  },
);

When('the bridge resolves {string}', async (world: BridgeWorld, uri: string) => {
  await capture(world, () => bridge(world).resolve(parseLocator(uri), { requester: 'shell' }));
});

When('the bridge resolves a magnet locator stripped of its hash', async (world: BridgeWorld) => {
  await capture(world, () => bridge(world).resolve({ scheme: 'magnet', raw: 'magnet:', fields: {} }, { requester: 'shell' }));
});

When('the bridge resolves a magnet locator with only its hash', async (world: BridgeWorld) => {
  const locator = { scheme: 'magnet', raw: 'magnet:', fields: { infoHash: 'abcdef0123456789abcdef0123456789abcdef01' } };
  await capture(world, () => bridge(world).resolve(locator, { requester: 'shell' }));
});

Then('bridge resolution fails with {string}', (world: BridgeWorld, reason: string) => {
  expectReason(world.error, reason);
});

Then('bridge resolution yields a job {string} labelled {string}', (world: BridgeWorld, id: string, label: string) => {
  expect(world.result).toEqual({ kind: 'job', id, label });
});

Then(
  'bridge resolution yields a conversation {string} with {string}',
  (world: BridgeWorld, id: string, participants: string) => {
    expect(world.result).toEqual({ kind: 'conversation', id, participants: splitList(participants) });
  },
);

Then('the backend was called with {string} and {string}', (world: BridgeWorld, first: string, second: string) => {
  const call = world.backendCalls?.at(0);
  expect(call?.slice(0, 2).map(asText)).toEqual([first, second]);
});

Then('the backend was called with {string}', (world: BridgeWorld, first: string) => {
  expect(world.backendCalls?.at(0)?.[0]).toBe(first);
});

Then('the backend was called with {string} and no subject', (world: BridgeWorld, first: string) => {
  expect(world.backendCalls?.at(0)?.slice(0, 2)).toEqual([first, undefined]);
});

Then('the backend was not called', (world: BridgeWorld) => {
  expect(world.backendCalls).toEqual([]);
});
