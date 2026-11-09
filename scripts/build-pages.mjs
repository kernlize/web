#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const outputRoot = resolve(repoRoot, process.env.PAGES_OUT_DIR || '.pages');

const inputs = [
  { source: join(repoRoot, 'apps', 'web', 'dist'), target: outputRoot, marker: 'index.html', label: 'Astro site build (pnpm --filter @kernlize/web build)' },
  { source: join(repoRoot, 'docs', '.vitepress', 'dist'), target: join(outputRoot, 'docs'), marker: 'index.html', label: 'VitePress docs build (pnpm docs:build)' },
  { source: join(repoRoot, 'docs', 'api'), target: join(outputRoot, 'docs', 'api'), marker: 'index.html', label: 'TypeDoc API build (pnpm docs:api)' },
];

const rel = (path) => relative(repoRoot, path) || '.';

function ensureInput({ source, marker, label }) {
  const file = join(source, marker);
  if (!existsSync(file) || !statSync(file).isFile()) {
    throw new Error(`[build-pages] missing ${rel(file)}; run the ${label} first`);
  }
}

for (const input of inputs) ensureInput(input);

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
for (const { source, target } of inputs) cpSync(source, target, { recursive: true });
writeFileSync(join(outputRoot, '.nojekyll'), '');

console.log(`[build-pages] OK - wrote ${rel(outputRoot)}/ (site at /, docs at /docs/, API at /docs/api/)`);
