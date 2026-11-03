import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { findViolations, scanDirectory } from './check-public-vocabulary.mjs';

const words = (text) => findViolations(text).map((hit) => hit.match);

test('flags every denylisted word, case-insensitively and in plural', () => {
  expect(words('Nostr relays and a pubkey')).toEqual(['Nostr', 'relays', 'pubkey']);
  expect(words('NIP-5D, NIP-17 and a nip')).toEqual(['NIP-', 'NIP-17', 'nip']);
  expect(words('napplet and napplets')).toEqual(['napplet', 'napplets']);
  expect(words('npub1abc nsec1xyz')).toEqual(['npub1abc', 'nsec1xyz']);
});

test('does not flag words that merely contain a denylisted word', () => {
  expect(words('unrelayed snippet relaying')).toEqual([]);
});

test('reports file, line and column', () => {
  const [hit] = findViolations('clean\n  a relay here', 'why/index.md');
  expect(hit).toMatchObject({ file: 'why/index.md', line: 2, column: 5, match: 'relay' });
});

test('skips URLs because the denylist applies to prose', () => {
  expect(words('see https://napplet.run/docs and [x](https://example.com/relay)')).toEqual([]);
  expect(words('https://napplet.run says napplet')).toEqual(['napplet']);
});

test('scans html, md, txt, json and xml files under a directory and nothing else', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vocab-'));
  await mkdir(path.join(dir, 'why'), { recursive: true });
  await writeFile(path.join(dir, 'index.html'), '<p>clean</p>');
  await writeFile(path.join(dir, 'why', 'index.md'), 'a relay');
  await writeFile(path.join(dir, 'notes.js'), 'const relay = 1');
  const hits = await scanDirectory(dir);
  expect(hits.map((hit) => hit.file)).toEqual([path.join('why', 'index.md')]);
});
