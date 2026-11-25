import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './load-source.mjs';

const words = loadSource('words.js');
const { actionsFor, extrasFor, draftFor, SETTINGS_SCHEMA, SAMPLE_MAGNET } = loadSource('actions.js');
const { SAMPLES, sampleFor, archetypesOf } = loadSource('specs.js');

const spec = (name) => SAMPLES.find((candidate) => candidate.name === name);

test('only Notes shows settings, only Pulse shows the extras', () => {
  assert.ok(actionsFor(spec('notes')).some((action) => action.id === 'settings'));
  assert.ok(!actionsFor(spec('pulse')).some((action) => action.id === 'settings'));
  assert.ok(!actionsFor(spec('profiles')).some((action) => action.id === 'settings'));
  assert.deepEqual(extrasFor(spec('pulse')).map((action) => action.id), ['contacts', 'servers', 'vanish']);
  assert.deepEqual(extrasFor(spec('notes')), []);
});

test('an unknown build mode falls back to Notes; Profiles accepts profile requests', () => {
  assert.equal(sampleFor('development').name, 'notes');
  assert.deepEqual(archetypesOf(spec('profiles')), [{ slug: 'profile', convention: 'napplet:profile/open', params: ['pubkey'] }]);
  assert.deepEqual(archetypesOf(spec('notes')), []);
});

test('every publishing and flood button needs OUTBOX, never the relay escape hatch', () => {
  const all = [...actionsFor(spec('pulse')), ...extrasFor(spec('pulse'))];
  for (const id of ['publish', 'profile', 'delete', 'flood', 'contacts', 'servers', 'vanish']) {
    assert.equal(all.find((action) => action.id === id).domain, 'outbox', id);
  }
  assert.ok(all.every((action) => action.domain !== 'relay'));
  assert.equal(words.notGranted('outbox'), 'Refused: this applet has no grant for posting to your network.');
});

test('each publishing button signs the kind it says', () => {
  const kinds = Object.fromEntries(['publish', 'profile', 'delete', 'contacts', 'servers', 'vanish'].map((id) => [id, draftFor(id, '').draft.kind]));
  assert.deepEqual(kinds, { publish: 1, profile: 0, delete: 5, contacts: 3, servers: 10002, vanish: 62 });
  assert.equal(draftFor('publish', '  hi  ').draft.content, 'hi');
  assert.equal(draftFor('publish', '   ').draft.content, 'Hello from a sample applet.');
  assert.equal(draftFor('notify', ''), undefined);
  assert.equal(SAMPLE_MAGNET, `magnet:?xt=urn:btih:${'ab'.repeat(20)}&dn=Sample`);
});

test('the settings schema matches the shell preview: size 12 to 24, default 15, a secret token', () => {
  const { size, token, tone, compact, signature } = SETTINGS_SCHEMA.properties;
  assert.deepEqual([size.minimum, size.maximum, size.default], [12, 24, 15]);
  assert.equal(token['x-napplet-secret'], true);
  assert.deepEqual(tone.enum, ['calm', 'bright']);
  assert.equal(compact.type, 'boolean');
  assert.equal(signature.default, '');
});

test('settings are echoed with the secret only said to be set', () => {
  assert.equal(words.describeValues({ size: 15, token: 'hunter2' }), 'Its settings: size 15, token set.');
  assert.equal(words.describeValues({}), 'Its settings: none yet.');
});

test('publish results keep the old texts', () => {
  assert.equal(words.publishDone('Note'), 'Note: done.');
  assert.equal(words.publishFailed('Profile', new Error('denied: the user declined')), 'Profile: you said no.');
  assert.equal(words.publishFailed('Note', new Error('timeout')), 'Note: not sent (timeout).');
});

test('intent, link, download and grant lines', () => {
  assert.equal(words.intentWords({ ok: true }, 'Profiles'), 'Profiles is taking it.');
  assert.equal(words.intentWords({ ok: true }, undefined), 'Another applet is taking it.');
  assert.equal(words.intentWords({ ok: false, error: 'no handler' }, undefined), 'Nobody took it (no handler).');
  assert.equal(words.linkWords({ status: 'opened' }), 'The link was opened.');
  assert.equal(words.linkWords({ status: 'denied' }), 'You did not open the link.');
  assert.equal(words.downloadWords({ ok: true }), 'Added to your downloads.');
  assert.equal(words.downloadWords({ ok: false }), 'The download could not be handed off.');
  assert.equal(words.notGranted('relay'), 'Refused: this applet has no grant for network.');
  assert.equal(words.grantedLine([]), 'Granted: nothing beyond the baseline.');
  assert.equal(words.grantedLine(['relay', 'notify']), 'Granted: network, notifications.');
  assert.equal(words.floodAnswered(40, 40), 'All 40 reads were answered.');
  assert.match(words.floodAnswered(8, 40), /^8 of 40 reads were answered/);
});

test('a delivery names the person only by a short id, and only when it is one', () => {
  const pubkey = 'decade00'.repeat(8);
  assert.equal(words.deliveryWords({ action: 'open', archetype: 'profile', payload: { pubkey } }), 'Another applet asked this applet to open a profile for decade00….');
  assert.equal(words.deliveryWords({ action: 'open', archetype: 'profile', payload: { pubkey: '<b>' } }), 'Another applet asked this applet to open a profile.');
});
