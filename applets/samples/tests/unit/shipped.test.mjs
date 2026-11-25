import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { schnorr } from '@noble/curves/secp256k1.js';
import { ship } from '../../scripts/ship.mjs';

// Runs after `pnpm build`: it reads shipped/ as the build left it.
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const shippedDir = join(root, 'shipped');
const shipped = JSON.parse(await readFile(join(shippedDir, 'samples.json'), 'utf8'));

// Written out here rather than imported, so a change to src/specs.ts has to be made twice.
const EXPECTED = {
  notes: { title: 'Notes', requires: ['identity', 'intent', 'outbox'], optional: ['config', 'link', 'notify', 'storage', 'torrent'], conventions: [] },
  pulse: { title: 'Pulse', requires: ['outbox'], optional: ['link', 'media', 'notify', 'resource', 'torrent'], conventions: [] },
  profiles: { title: 'Profiles', requires: [], optional: ['intent', 'notify'], conventions: ['napplet:profile/open'] },
};

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
const values = (tags, name) => tags.filter((tag) => tag[0] === name).map((tag) => tag[1]);
const recomputedId = (event) =>
  sha256Hex(JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]));

test('ships three samples under one publisher', () => {
  assert.match(shipped.publisher, /^[0-9a-f]{64}$/);
  assert.deepEqual(shipped.samples.map((sample) => sample.name), ['notes', 'pulse', 'profiles']);
  for (const sample of shipped.samples) {
    assert.equal(sample.file, `${sample.name}.html`);
    assert.equal(sample.manifest.pubkey, shipped.publisher);
    assert.equal(sample.manifest.kind, 35129);
    assert.deepEqual(Object.keys(sample.manifest).sort(), ['content', 'created_at', 'id', 'kind', 'pubkey', 'sig', 'tags']);
  }
});

test('every manifest id recomputes and its signature verifies against the publisher', () => {
  for (const { name, manifest } of shipped.samples) {
    assert.equal(manifest.id, recomputedId(manifest), name);
    const verified = schnorr.verify(Buffer.from(manifest.sig, 'hex'), Buffer.from(manifest.id, 'hex'), Buffer.from(shipped.publisher, 'hex'));
    assert.equal(verified, true, name);
  }
});

test('the publisher\'s profile names the samples and verifies against the publisher', () => {
  const { profile } = shipped;
  assert.equal(profile.kind, 0);
  assert.equal(profile.pubkey, shipped.publisher);
  assert.deepEqual(JSON.parse(profile.content), { name: 'kernl samples' });
  assert.equal(profile.id, recomputedId(profile));
  assert.equal(schnorr.verify(Buffer.from(profile.sig, 'hex'), Buffer.from(profile.id, 'hex'), Buffer.from(shipped.publisher, 'hex')), true);
});

test('a tampered manifest no longer verifies', () => {
  const { manifest } = shipped.samples[0];
  const tampered = { ...manifest, content: `${manifest.content} ` };
  assert.notEqual(recomputedId(tampered), manifest.id);
  const forged = Buffer.from(recomputedId(tampered), 'hex');
  assert.equal(schnorr.verify(Buffer.from(manifest.sig, 'hex'), forged, Buffer.from(shipped.publisher, 'hex')), false);
});

test('every x tag is the sha256 of the shipped html', async () => {
  for (const { name, file, manifest } of shipped.samples) {
    const html = await readFile(join(shippedDir, file));
    assert.deepEqual(values(manifest.tags, 'x'), [sha256Hex(html)], name);
  }
});

test('d tags, titles, requires, optional and conventions match the specs', () => {
  for (const { name, title, manifest } of shipped.samples) {
    const expected = EXPECTED[name];
    assert.deepEqual(values(manifest.tags, 'd'), [name]);
    assert.equal(title, expected.title);
    assert.deepEqual(values(manifest.tags, 'title'), [expected.title]);
    assert.deepEqual(values(manifest.tags, 'R').sort(), expected.requires, name);
    assert.deepEqual(values(manifest.tags, 'O').sort(), expected.optional, name);
    assert.deepEqual(values(manifest.tags, 'i'), expected.conventions, name);
  }
  const profiles = shipped.samples.find((sample) => sample.name === 'profiles').manifest;
  assert.deepEqual(values(profiles.tags, 'z'), ['profile']);
  assert.deepEqual(profiles.tags.find((tag) => tag[0] === 'i'), ['i', 'napplet:profile/open', 'pubkey']);
});

test('the shipped html carries no key material', async () => {
  const listing = JSON.stringify(shipped);
  assert.doesNotMatch(listing, /secret|nsec/i);
  for (const { file } of shipped.samples) assert.doesNotMatch(await readFile(join(shippedDir, file), 'utf8'), /nsec1/);
});

test('two builds sign with different publishers', async () => {
  const first = await ship(await mkdtemp(join(tmpdir(), 'kernl-samples-')));
  const second = await ship(await mkdtemp(join(tmpdir(), 'kernl-samples-')));
  assert.notEqual(first.publisher, second.publisher);
  assert.notEqual(first.publisher, shipped.publisher);
  for (const run of [first, second]) {
    for (const { manifest } of run.samples) {
      assert.equal(manifest.pubkey, run.publisher);
      assert.equal(manifest.id, recomputedId(manifest));
    }
  }
});
