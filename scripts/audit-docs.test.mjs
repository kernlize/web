import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import {
  checkApiHrefs,
  checkDistAgentOutput,
  checkPackagePages,
  checkSidebarCoverage,
  checkTypeDocModules,
  publicPackages,
  routeFor,
  servedPath,
  sidebarRoutes,
  typedocModuleFile,
} from './audit-docs.mjs';

const roots = [];

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'audit-docs-'));
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

const manifest = (name, version = '0.1.0') => JSON.stringify({ name, version });
const page = (name, version = '0.1.0') =>
  `# ${name}\n\n| Version | \`${version}\` |\n\n[api](/api/modules/${typedocModuleFile(name)}){target="_self"}\n`;

test('typedocModuleFile mirrors TypeDoc package naming', () => {
  expect(typedocModuleFile('@kernlize/guard')).toBe('_kernlize_guard.html');
  expect(typedocModuleFile('@kernlize/core')).toBe('_kernlize_core.html');
});

test('publicPackages lists scoped packages sorted by slug and skips others', () => {
  const root = fixture({
    'packages/guard/package.json': manifest('@kernlize/guard'),
    'packages/bridges/package.json': manifest('@kernlize/bridges', '0.2.0'),
    'packages/other/package.json': manifest('@other/thing'),
    'packages/empty/.keep': '',
  });
  expect(publicPackages(join(root, 'packages'))).toEqual([
    { slug: 'bridges', name: '@kernlize/bridges', version: '0.2.0' },
    { slug: 'guard', name: '@kernlize/guard', version: '0.1.0' },
  ]);
  expect(publicPackages(join(root, 'nowhere'))).toEqual([]);
});

test('checkPackagePages passes a complete page and index', () => {
  const root = fixture({
    'docs/packages/index.md': '# Packages\n\n[guard](./guard.md)\n',
    'docs/packages/guard.md': page('@kernlize/guard'),
  });
  const packages = [{ slug: 'guard', name: '@kernlize/guard', version: '0.1.0' }];
  expect(checkPackagePages({ docsDir: join(root, 'docs'), packages })).toEqual([]);
});

test('checkPackagePages reports a missing page, a wrong version row, a missing link and a missing index entry', () => {
  const root = fixture({
    'docs/packages/index.md': '# Packages\n',
    'docs/packages/guard.md': '# @kernlize/guard\n\n| Version | `0.0.9` |\n',
  });
  const packages = [
    { slug: 'guard', name: '@kernlize/guard', version: '0.1.0' },
    { slug: 'core', name: '@kernlize/core', version: '0.1.0' },
  ];
  const violations = checkPackagePages({ docsDir: join(root, 'docs'), packages });
  expect(violations).toContain('@kernlize/core: missing docs/packages/core.md');
  expect(violations).toContain('@kernlize/guard: docs/packages/guard.md lacks the row | Version | `0.1.0` |');
  expect(violations).toContain('@kernlize/guard: docs/packages/guard.md does not link /api/modules/_kernlize_guard.html');
  expect(violations).toContain('docs/packages/index.md does not link ./guard.md');
});

test('checkPackagePages reports a missing package index', () => {
  const root = fixture({ 'docs/packages/guard.md': page('@kernlize/guard') });
  const packages = [{ slug: 'guard', name: '@kernlize/guard', version: '0.1.0' }];
  expect(checkPackagePages({ docsDir: join(root, 'docs'), packages })).toEqual(['missing docs/packages/index.md']);
});

test('routeFor and sidebarRoutes agree on index and nested pages', () => {
  expect(routeFor('index.md')).toBe('/');
  expect(routeFor('packages/index.md')).toBe('/packages/');
  expect(routeFor('concepts/guard.md')).toBe('/concepts/guard');
  const routes = sidebarRoutes(`link: '/' }, { link: "/packages/" }, { link: '/concepts/guard#x' }, { link: 'https://x' }`);
  expect([...routes]).toEqual(['/', '/packages/', '/concepts/guard']);
});

test('checkSidebarCoverage ignores .vitepress, api and node_modules and reports unlinked pages', () => {
  const root = fixture({
    'docs/index.md': '# Home\n',
    'docs/concepts/guard.md': '# Guard\n',
    'docs/concepts/orphan.md': '# Orphan\n',
    'docs/.vitepress/theme/readme.md': 'ignored',
    'docs/api/readme.md': 'ignored',
    'docs/node_modules/x/readme.md': 'ignored',
  });
  const configSource = `sidebar: [{ items: [{ link: '/' }, { link: '/concepts/guard' }] }]`;
  expect(checkSidebarCoverage({ docsDir: join(root, 'docs'), configSource })).toEqual([
    "docs/concepts/orphan.md is not linked from the sidebar (expected link: '/concepts/orphan')",
  ]);
});

test('checkDistAgentOutput requires llms files and a twin per page, skipping 404 and assets', () => {
  const root = fixture({
    'dist/index.html': '',
    'dist/index.md': '',
    'dist/404.html': '',
    'dist/concepts/guard.html': '',
    'dist/assets/chunk.html': '',
    'dist/llms.txt': '',
  });
  expect(checkDistAgentOutput({ distDir: join(root, 'dist') })).toEqual([
    'built docs lack llms-full.txt',
    'built docs lack the Markdown twin concepts/guard.md for concepts/guard.html',
  ]);
  expect(checkDistAgentOutput({ distDir: join(root, 'missing') })).toEqual([
    `missing built docs at ${join(root, 'missing')}; run pnpm docs:build first`,
  ]);
});

test('checkTypeDocModules reports each missing module page', () => {
  const root = fixture({ 'api/modules/_kernlize_guard.html': '' });
  const packages = [{ name: '@kernlize/guard' }, { name: '@kernlize/core' }];
  expect(checkTypeDocModules({ apiDir: join(root, 'api'), packages })).toEqual([
    `TypeDoc module page missing: ${join(root, 'api', 'modules', '_kernlize_core.html')}`,
  ]);
});

test('servedPath maps built pages to their clean URLs under the base', () => {
  expect(servedPath('index.html', '/docs/')).toBe('/docs/');
  expect(servedPath('packages/index.html', '/docs/')).toBe('/docs/packages/');
  expect(servedPath('packages/core.html', '/web/docs/')).toBe('/web/docs/packages/core');
});

test('checkApiHrefs accepts relative API links that resolve under the base to existing files', () => {
  const files = new Set(['modules/_kernlize_core.html', 'index.html']);
  const pages = [
    { path: 'packages/core.html', html: '<a href="../api/modules/_kernlize_core.html" target="_self">core</a>' },
    { path: 'reference/api.html', html: '<a href="../api/index.html#top">index</a> <a href="/docs/api/">root</a>' },
    { path: 'index.html', html: '<a href="https://example.org/api/x.html">ext</a> <a href="#api/x">frag</a> <a href="./concepts/guard">guard</a>' },
  ];
  expect(checkApiHrefs({ pages, base: '/docs/', apiFileExists: (path) => files.has(path) })).toEqual([]);
});

test('checkApiHrefs reports API links that escape the base or name a missing file', () => {
  const pages = [
    { path: 'packages/core.html', html: '<a href="/api/modules/_kernlize_core.html" target="_self">core</a>' },
    { path: 'packages/guard.html', html: '<a href="../api/modules/_kernlize_gaurd.html">guard</a>' },
  ];
  expect(checkApiHrefs({ pages, base: '/docs/', apiFileExists: () => false })).toEqual([
    'packages/core.html: href "/api/modules/_kernlize_core.html" resolves to /api/modules/_kernlize_core.html, outside /docs/api/',
    'packages/guard.html: href "../api/modules/_kernlize_gaurd.html" resolves to /docs/api/modules/_kernlize_gaurd.html, which docs/api does not contain',
  ]);
});
