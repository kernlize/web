#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FRAMEWORKS = ['svelte', 'react', 'vue', 'preact', 'solid-js', 'lit'];
export const KEHTO_ALLOWANCES = { guard: ['@kehto/firewall'] };
const LEAF_PACKAGES = ['guard', 'messaging', 'bridges'];
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'];

const PACKAGE_SOURCE = /\.(?:ts|mts|js|mjs)$/;
const APP_SOURCE = /\.(?:ts|mts|js|mjs|svelte|astro)$/;

function sourceFiles(dir, pattern = PACKAGE_SOURCE) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, pattern);
    return pattern.test(entry.name) && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

/**
 * Collect the module specifiers a source file imports, re-exports or dynamically imports.
 * @param {string} source File contents.
 * @returns {string[]} Specifiers in order of appearance.
 * @example
 * importSpecifiers("import { a } from 'x';\nexport * from 'y';\nawait import('z');"); // ['x', 'y', 'z']
 */
export function importSpecifiers(source) {
  const pattern = /(?:\bimport|\bexport)\s+(?:type\s+)?(?:[\w*\s{},$]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  return [...source.matchAll(pattern)].map((match) => match[1] ?? match[2]);
}

const packageOf = (specifier) => (specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);

/**
 * Find source files under `packages/*\/src` that import `nostr-tools`.
 * @param {string} packagesDir Absolute path of the packages directory.
 * @returns {string[]} One violation per offending import.
 * @example
 * findNostrToolsImports('/repo/packages'); // []
 */
export function findNostrToolsImports(packagesDir) {
  const violations = [];
  for (const slug of packageSlugs(packagesDir)) {
    for (const file of sourceFiles(join(packagesDir, slug, 'src'))) {
      const offending = importSpecifiers(readFileSync(file, 'utf8')).filter((spec) => packageOf(spec) === 'nostr-tools');
      for (const spec of offending) violations.push(`${relative(packagesDir, file)} imports ${spec}; kernl source never imports nostr-tools (D-002)`);
    }
  }
  return violations;
}

/**
 * Find `nostr-tools` imports in the web app's source, Svelte and Astro files included.
 * The shell reaches the protocol only through `@kernl/*` and applesauce (D-002).
 * @param {string} appSrcDir Absolute path of `apps/web/src`.
 * @returns {string[]} One violation per offending import, with the path relative to the app directory.
 * @example
 * findAppNostrToolsImports('/repo/apps/web/src'); // []
 */
export function findAppNostrToolsImports(appSrcDir) {
  const violations = [];
  for (const file of sourceFiles(appSrcDir, APP_SOURCE)) {
    const offending = importSpecifiers(readFileSync(file, 'utf8')).filter((spec) => packageOf(spec) === 'nostr-tools');
    for (const spec of offending) violations.push(`${relative(join(appSrcDir, '..'), file)} imports ${spec}; the web app never imports nostr-tools (D-002)`);
  }
  return violations;
}

/**
 * Find `@kehto/*` imports in the leaf packages, allowing only `guard → @kehto/firewall`.
 * @param {string} packagesDir Absolute path of the packages directory.
 * @returns {string[]} One violation per offending import.
 * @example
 * findKehtoImports('/repo/packages'); // []
 */
export function findKehtoImports(packagesDir) {
  const violations = [];
  for (const slug of LEAF_PACKAGES) {
    const allowed = new Set(KEHTO_ALLOWANCES[slug] ?? []);
    for (const file of sourceFiles(join(packagesDir, slug, 'src'))) {
      const offending = importSpecifiers(readFileSync(file, 'utf8')).filter((spec) => spec.startsWith('@kehto/') && !allowed.has(packageOf(spec)));
      for (const spec of offending) violations.push(`${relative(packagesDir, file)} imports ${spec}; only @kernl/core composes kehto (guard may import @kehto/firewall)`);
    }
  }
  return violations;
}

/**
 * Find UI framework dependencies declared by any package manifest.
 * @param {string} packagesDir Absolute path of the packages directory.
 * @returns {string[]} One violation per framework entry in any dependency field.
 * @example
 * findFrameworkDependencies('/repo/packages'); // []
 */
export function findFrameworkDependencies(packagesDir) {
  const violations = [];
  for (const slug of packageSlugs(packagesDir)) {
    const manifest = JSON.parse(readFileSync(join(packagesDir, slug, 'package.json'), 'utf8'));
    for (const field of DEPENDENCY_FIELDS) {
      const names = Object.keys(manifest[field] ?? {}).filter((name) => FRAMEWORKS.includes(name));
      for (const name of names) violations.push(`packages/${slug}/package.json lists ${name} in ${field}; published packages have zero framework dependencies (D-004)`);
    }
  }
  return violations;
}

function packageSlugs(packagesDir) {
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir).filter((slug) => existsSync(join(packagesDir, slug, 'package.json'))).sort();
}

/**
 * Run every dependency rule against a packages directory and, when given, the web app's source.
 * @param {string} packagesDir Absolute path of the packages directory.
 * @param {string} [appSrcDir] Absolute path of `apps/web/src`.
 * @returns {string[]} All violations.
 * @example
 * checkDependencyRules('/repo/packages', '/repo/apps/web/src'); // []
 */
export function checkDependencyRules(packagesDir, appSrcDir) {
  return [
    ...findNostrToolsImports(packagesDir),
    ...findKehtoImports(packagesDir),
    ...findFrameworkDependencies(packagesDir),
    ...(appSrcDir ? findAppNostrToolsImports(appSrcDir) : []),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = checkDependencyRules(
    resolve(new URL('../packages', import.meta.url).pathname),
    resolve(new URL('../apps/web/src', import.meta.url).pathname),
  );
  if (violations.length) {
    console.error(`[check-deps] ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
  console.log('[check-deps] OK');
}
