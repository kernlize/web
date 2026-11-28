import { describe, expect, it, vi } from 'vitest';
import { alreadyGranted, reviewAppletLink } from './applet-link';
import type { AppletSummary, GrantRecord, InstalledApplet } from './contract';

const target = { title: 'Routstr Stats', identity: { dTag: 'stats', hash: 'new' }, manifest: { catalogId: 'stats', archetypes: [] }, requires: ['outbox'] } as unknown as AppletSummary;
const pointer = { kind: 'address', pubkey: 'a'.repeat(64), eventKind: 35129, identifier: 'stats', relays: [] } as const;
const source = { ...target, title: 'Toy Rocket', identity: { dTag: 'tree', hash: 'source' } };

describe('installed applet links', () => {
  const standing = { domains: ['outbox'], withheld: [], blocked: false } as unknown as GrantRecord;
  function has(hash: string | undefined, grant: GrantRecord | undefined, offered = true, catalogId = 'stats', baseline = false, applet = target) {
    const kernl = {
      intents: { installed: () => [{ catalogId, artifactHash: hash } as InstalledApplet] },
      grants: { get: () => grant, baselineDomains: () => baseline ? ['outbox'] : [], availableDomains: () => offered ? ['outbox'] : [] },
    };
    return alreadyGranted(kernl, applet);
  }
  it('matches the catalog, artifact and grants, including availability and withheld permissions', () => {
    expect(has('new', standing)).toBe(true);
    expect(has('new', { ...standing, domains: [] }, true, 'stats', true)).toBe(true);
    expect(has(undefined, standing)).toBe(false);
    expect(has('old', standing)).toBe(false);
    expect(has('new', standing, true, 'another')).toBe(false);
    expect(has('new', undefined)).toBe(false);
    expect(has('new', { ...standing, blocked: true })).toBe(false);
    expect(has('new', { ...standing, withheld: ['outbox'] })).toBe(false);
    expect(has('new', { ...standing, domains: [] })).toBe(false);
    expect(has('new', standing, false)).toBe(false);
    expect(has('new', standing, true, 'stats', false, { ...target, manifest: { ...target.manifest, archetypes: [{} as AppletSummary['manifest']['archetypes'][number]] } })).toBe(false);
  });
});

describe('reviewing an applet link', () => {
  function setup() {
    let running = true;
    const resolve = vi.fn(async () => target);
    const review = vi.fn(async () => true);
    const failed = vi.fn();
    const open = reviewAppletLink({ kernl: { resolve }, review, failed, source: () => running ? source : undefined });
    return { resolve, review, failed, open, close: () => { running = false; } };
  }

  it('resolves and reviews the verified names, and propagates the decision', async () => {
    const { open, resolve, review } = setup();
    const { signal } = new AbortController();
    expect(await open('source', pointer, signal)).toBe(true);
    expect(resolve).toHaveBeenCalledWith(pointer);
    expect(review).toHaveBeenCalledWith(expect.objectContaining({ windowId: 'source', facts: { source: 'Toy Rocket', target }, signal }));
    review.mockResolvedValueOnce(false);
    expect(await open('source', pointer)).toBe(false);
  });

  it('does not start for closed, aborted or already pending sources', async () => {
    const { open, resolve, review, close } = setup();
    const controller = new AbortController();
    controller.abort();
    expect(await open('source', pointer, controller.signal)).toBe(false);
    const pending = open('source', pointer);
    const repeated = open('source', pointer);
    close();
    expect(await repeated).toBe(false);
    expect(await pending).toBe(false);
    expect(await open('source', pointer)).toBe(false);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(review).not.toHaveBeenCalled();
  });

  it('withdraws after approval if the operation is no longer active', async () => {
    const { open, review } = setup();
    const controller = new AbortController();
    review.mockImplementationOnce(async () => { controller.abort(); return true; });
    expect(await open('source', pointer, controller.signal)).toBe(false);
  });

  it('reports lookup failures only to a source that is still active', async () => {
    const { open, resolve, failed, close } = setup();
    const trouble = new Error('unavailable:manifest');
    resolve.mockRejectedValue(trouble);
    expect(await open('source', pointer)).toBe(false);
    expect(failed).toHaveBeenCalledWith(trouble);
    resolve.mockImplementationOnce(async () => { close(); throw trouble; });
    expect(await open('source', pointer)).toBe(false);
    expect(failed).toHaveBeenCalledOnce();
  });
});
