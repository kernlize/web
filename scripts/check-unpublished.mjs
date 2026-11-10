// D-034: a release is whatever main carries that a registry does not have. Lists every public package version
// that npm or JSR is missing; release.yml publishes when the list is not empty. A registry that cannot be
// asked is an error, never an empty list, so an outage cannot look like "nothing to publish".
import { appendFile, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const NPM_REGISTRY = 'https://registry.npmjs.org/';
export const JSR_REGISTRY = 'https://jsr.io/';
/** D-021: npm belongs to `@kernlize`, JSR to `@kernl`; the slug is the same on both. */
export const JSR_SCOPE = '@kernl';

/**
 * Read the publishable workspace packages.
 * @param {string} root Repository root.
 * @returns {Promise<{ slug: string, name: string, version: string }[]>} Each public package under `packages/`, in directory order.
 * @example
 * (await listPackages('.')).map((pkg) => `${pkg.name}@${pkg.version}`); // ['@kernlize/bridges@0.2.1', ...]
 */
export async function listPackages(root) {
  const packages = [];
  for (const slug of (await readdir(path.join(root, 'packages'))).sort()) {
    const manifest = JSON.parse(await readFile(path.join(root, 'packages', slug, 'package.json'), 'utf8'));
    if (!manifest.private) packages.push({ slug, name: manifest.name, version: manifest.version });
  }
  return packages;
}

async function versionsAt(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return new Set(Object.keys((await response.json()).versions ?? {}));
}

/**
 * The published versions of a package on each registry, or null when the registry has no such package.
 * @param {typeof fetch} [fetchImpl] The fetch to ask with.
 * @returns {{ npm: (pkg: { name: string }) => Promise<Set<string> | null>, jsr: (pkg: { slug: string }) => Promise<Set<string> | null> }} One lookup per registry.
 * @example
 * const { npm } = registryLookups();
 * (await npm({ name: '@kernlize/guard' }))?.has('0.1.1');
 */
export function registryLookups(fetchImpl = globalThis.fetch) {
  return {
    npm: (pkg) => versionsAt(`${NPM_REGISTRY}${pkg.name.replace('/', '%2F')}`, fetchImpl),
    jsr: (pkg) => versionsAt(`${JSR_REGISTRY}${JSR_SCOPE}/${pkg.slug}/meta.json`, fetchImpl),
  };
}

/**
 * Find every package version a registry is missing.
 * @param {{ slug: string, name: string, version: string }[]} packages The workspace packages.
 * @param {ReturnType<typeof registryLookups>} lookups The registry lookups.
 * @returns {Promise<{ registry: 'npm' | 'jsr', name: string, version: string, reason: string }[]>} One row per missing version, npm rows first.
 * @example
 * const pending = await unpublished(await listPackages('.'), registryLookups());
 * if (pending.length) console.log('release needed');
 */
export async function unpublished(packages, lookups) {
  const rows = [];
  for (const registry of ['npm', 'jsr']) {
    for (const pkg of packages) {
      const name = registry === 'jsr' ? `${JSR_SCOPE}/${pkg.slug}` : pkg.name;
      const versions = await lookups[registry](pkg);
      if (versions === null) rows.push({ registry, name, version: pkg.version, reason: 'the package does not exist there yet' });
      else if (!versions.has(pkg.version)) rows.push({ registry, name, version: pkg.version, reason: 'the version is not published' });
    }
  }
  return rows;
}

/**
 * Render the rows for a log.
 * @param {Awaited<ReturnType<typeof unpublished>>} rows The missing versions.
 * @param {number} count How many packages were checked.
 * @returns {string} One line per row and a summary.
 * @example
 * console.log(renderPending([], 4)); // '4 packages checked on npm and JSR: nothing to publish'
 */
export function renderPending(rows, count) {
  const lines = rows.map((row) => `${row.registry.padEnd(4)} ${row.name}@${row.version}  ${row.reason}`);
  const summary = rows.length ? `${rows.length} version(s) to publish` : 'nothing to publish';
  return [...lines, `${count} packages checked on npm and JSR: ${summary}`].join('\n');
}

async function main() {
  const packages = await listPackages(path.resolve(import.meta.dirname, '..'));
  const rows = await unpublished(packages, registryLookups());
  process.stdout.write(`${renderPending(rows, packages.length)}\n`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `pending=${rows.length > 0}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
