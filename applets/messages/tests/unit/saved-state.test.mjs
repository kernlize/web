import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSource } from './load-source.mjs';

const { parseSaved, serializeSaved } = loadSource('saved-state.ts');

test('round-trips drafts and last-seen times as one stored value', () => {
  const seen = { baseline: 1000, threads: { 'direct:a': 2000 } };
  const drafts = new Map([['direct:a', 'hello\nthere'], ['group:g', 'x']]);
  const restored = parseSaved(serializeSaved(drafts, seen));
  assert.deepEqual(restored.seen, seen);
  assert.deepEqual([...restored.drafts], [...drafts]);
});

test('reports a first run for missing or unreadable state', () => {
  for (const raw of [null, '', 'not json', '[]', '{}', '{"seen":{"baseline":"1"}}', '7', '{"seen":[]}']) {
    const restored = parseSaved(raw);
    assert.equal(restored.seen, null, String(raw));
    assert.equal(restored.drafts.size, 0, String(raw));
  }
});

test('keeps what is readable and drops the rest', () => {
  const raw = '{"seen":{"baseline":5,"threads":{"a":9,"b":"x","c":null}},"drafts":{"a":"keep","b":7,"c":""}}';
  const restored = parseSaved(raw);
  assert.deepEqual(restored.seen, { baseline: 5, threads: { a: 9 } });
  assert.deepEqual([...restored.drafts], [['a', 'keep']]);
});

test('keeps drafts even when the last-seen part is unreadable', () => {
  const restored = parseSaved('{"seen":null,"drafts":{"a":"still here"}}');
  assert.equal(restored.seen, null);
  assert.deepEqual([...restored.drafts], [['a', 'still here']]);
});

test('caps a stored draft so one thread cannot fill the storage quota', () => {
  const stored = JSON.parse(serializeSaved(new Map([['a', 'x'.repeat(20_000)]]), { baseline: 0, threads: {} }));
  assert.equal(stored.drafts.a.length, 8000);
});
