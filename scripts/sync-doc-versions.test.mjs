import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { syncDocVersions, syncVersionCells } from './sync-doc-versions.mjs';

const roots = [];

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'sync-doc-versions-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const guard = { slug: 'guard', name: '@kernl/guard', version: '0.2.0' };

test('a package page takes the manifest version', () => {
  expect(syncVersionCells('# @kernl/guard\n\n| Version | `0.1.0` |\n', guard)).toBe('# @kernl/guard\n\n| Version | `0.2.0` |\n');
});

test('the index row of that package changes and other rows do not', () => {
  const index = '| [`@kernl/guard`](./guard.md) | `0.1.0` | Role |\n| [`@kernl/core`](./core.md) | `0.1.0` | Role |\n';
  expect(syncVersionCells(index, guard)).toBe('| [`@kernl/guard`](./guard.md) | `0.2.0` | Role |\n| [`@kernl/core`](./core.md) | `0.1.0` | Role |\n');
});

test('syncing a repository rewrites stale pages and the index, and reports only what changed', () => {
  const root = fixture({
    'packages/guard/package.json': JSON.stringify({ name: '@kernl/guard', version: '0.2.0' }),
    'packages/core/package.json': JSON.stringify({ name: '@kernl/core', version: '0.1.0' }),
    'packages/other/package.json': JSON.stringify({ name: 'other', version: '9.9.9' }),
    'docs/packages/guard.md': '| Version | `0.1.0` |\n',
    'docs/packages/core.md': '| Version | `0.1.0` |\n',
    'docs/packages/index.md': '| [`@kernl/guard`](./guard.md) | `0.1.0` |\n| [`@kernl/core`](./core.md) | `0.1.0` |\n',
  });
  expect(syncDocVersions(root)).toEqual(['docs/packages/guard.md', 'docs/packages/index.md']);
  expect(readFileSync(join(root, 'docs/packages/guard.md'), 'utf8')).toBe('| Version | `0.2.0` |\n');
  expect(readFileSync(join(root, 'docs/packages/index.md'), 'utf8')).toContain('(./guard.md) | `0.2.0` |');
  expect(syncDocVersions(root)).toEqual([]);
});

test('a package without a docs page is skipped', () => {
  const root = fixture({ 'packages/guard/package.json': JSON.stringify({ name: '@kernl/guard', version: '0.2.0' }) });
  expect(syncDocVersions(root)).toEqual([]);
});
