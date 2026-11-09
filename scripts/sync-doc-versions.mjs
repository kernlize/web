#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicPackages } from './audit-docs.mjs';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const indexRow = (slug) => new RegExp(`(\\(\\./${escape(slug)}\\.md\\) \\| \`)[^\`]+(\` \\|)`, 'g');

/**
 * Rewrite the version cells of the package docs to match each manifest, so `changeset version` leaves the docs gate green.
 * @param {string} source Markdown of a package page or of `docs/packages/index.md`.
 * @param {{ slug: string, name: string, version: string }} pkg Package whose version is authoritative.
 * @returns {string} The markdown with that package's version cells updated.
 * @example
 * syncVersionCells('| Version | `0.1.0` |', { slug: 'guard', name: '@kernlize/guard', version: '0.2.0' }); // '| Version | `0.2.0` |'
 */
export function syncVersionCells(source, pkg) {
  return source
    .replace(/(\| Version \| `)[^`]+(` \|)/, `$1${pkg.version}$2`)
    .replace(indexRow(pkg.slug), `$1${pkg.version}$2`);
}

/**
 * Sync every package page and the packages index under a repository root.
 * @param {string} repoRoot Absolute path of the repository.
 * @returns {string[]} Repository-relative paths that changed.
 * @example
 * syncDocVersions('/repo'); // ['docs/packages/core.md', 'docs/packages/index.md']
 */
export function syncDocVersions(repoRoot) {
  const packages = publicPackages(join(repoRoot, 'packages'));
  const changed = [];
  const rewrite = (relativePath, transform) => {
    const path = join(repoRoot, relativePath);
    if (!existsSync(path)) return;
    const before = readFileSync(path, 'utf8');
    const after = transform(before);
    if (after === before) return;
    writeFileSync(path, after);
    changed.push(relativePath);
  };
  for (const pkg of packages) {
    rewrite(`docs/packages/${pkg.slug}.md`, (source) => syncVersionCells(source, pkg));
  }
  rewrite('docs/packages/index.md', (source) => packages.reduce((text, pkg) => text.replace(indexRow(pkg.slug), `$1${pkg.version}$2`), source));
  return changed;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changed = syncDocVersions(resolve(new URL('..', import.meta.url).pathname));
  console.log(changed.length ? `[sync-doc-versions] updated ${changed.join(', ')}` : '[sync-doc-versions] up to date');
}
