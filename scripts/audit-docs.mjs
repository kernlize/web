#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCOPE = '@kernl/';

/**
 * TypeDoc 0.28 with `entryPointStrategy: packages` names each module page after the package name with every non-word character replaced by `_`.
 * @param {string} packageName Package name such as `@kernl/guard`.
 * @returns {string} File name such as `_kernl_guard.html`.
 * @example
 * typedocModuleFile('@kernl/guard'); // '_kernl_guard.html'
 */
export function typedocModuleFile(packageName) {
  return `${packageName.replace(/[^\w]/g, '_')}.html`;
}

/**
 * Read every published package manifest under a packages directory.
 * @param {string} packagesDir Absolute path of the `packages/` directory.
 * @returns {{ slug: string, name: string, version: string }[]} Packages in the kernl scope, sorted by slug.
 * @example
 * publicPackages('/repo/packages'); // [{ slug: 'guard', name: '@kernl/guard', version: '0.1.0' }, …]
 */
export function publicPackages(packagesDir) {
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir)
    .map((slug) => ({ slug, manifest: join(packagesDir, slug, 'package.json') }))
    .filter(({ manifest }) => existsSync(manifest))
    .map(({ slug, manifest }) => ({ slug, ...JSON.parse(readFileSync(manifest, 'utf8')) }))
    .filter((pkg) => typeof pkg.name === 'string' && pkg.name.startsWith(SCOPE))
    .map(({ slug, name, version }) => ({ slug, name, version }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Check that each package has a docs page with the exact version row and a TypeDoc link.
 * @param {{ docsDir: string, packages: { slug: string, name: string, version: string }[] }} input Docs root and the packages to check.
 * @returns {string[]} Violations, empty when every page is in order.
 * @example
 * checkPackagePages({ docsDir: '/repo/docs', packages: publicPackages('/repo/packages') });
 */
export function checkPackagePages({ docsDir, packages }) {
  const violations = [];
  const indexPath = join(docsDir, 'packages', 'index.md');
  const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
  if (index === null) violations.push(`missing docs/packages/index.md`);
  for (const pkg of packages) {
    const pagePath = join(docsDir, 'packages', `${pkg.slug}.md`);
    if (!existsSync(pagePath)) {
      violations.push(`${pkg.name}: missing docs/packages/${pkg.slug}.md`);
      continue;
    }
    const page = readFileSync(pagePath, 'utf8');
    const versionRow = `| Version | \`${pkg.version}\` |`;
    if (!page.includes(versionRow)) violations.push(`${pkg.name}: docs/packages/${pkg.slug}.md lacks the row ${versionRow}`);
    if (!page.startsWith(`# ${pkg.name}\n`)) violations.push(`${pkg.name}: docs/packages/${pkg.slug}.md must start with "# ${pkg.name}"`);
    const moduleLink = `/api/modules/${typedocModuleFile(pkg.name)}`;
    if (!page.includes(moduleLink)) violations.push(`${pkg.name}: docs/packages/${pkg.slug}.md does not link ${moduleLink}`);
    if (index !== null && !index.includes(`./${pkg.slug}.md`)) violations.push(`docs/packages/index.md does not link ./${pkg.slug}.md`);
  }
  return violations;
}

function markdownFiles(dir, root = dir) {
  const skip = new Set(['.vitepress', 'api', 'node_modules']);
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return skip.has(entry.name) ? [] : markdownFiles(join(dir, entry.name), root);
    return entry.name.endsWith('.md') ? [relative(root, join(dir, entry.name)).split('\\').join('/')] : [];
  });
}

/**
 * Collect the absolute sidebar and nav routes declared in a VitePress config source.
 * @param {string} configSource Contents of `docs/.vitepress/config.ts`.
 * @returns {Set<string>} Routes such as `/`, `/concepts/guard`, `/packages/`.
 * @example
 * sidebarRoutes("link: '/concepts/guard'"); // Set { '/concepts/guard' }
 */
export function sidebarRoutes(configSource) {
  const routes = new Set();
  for (const match of configSource.matchAll(/link:\s*['"]([^'"]+)['"]/g)) {
    if (match[1].startsWith('/')) routes.add(match[1].replace(/[?#].*$/, ''));
  }
  return routes;
}

/**
 * Convert a docs source path to the sidebar route that would link it.
 * @param {string} relativePath Path such as `concepts/guard.md` or `packages/index.md`.
 * @returns {string} Route such as `/concepts/guard` or `/packages/`.
 * @example
 * routeFor('packages/index.md'); // '/packages/'
 */
export function routeFor(relativePath) {
  return `/${relativePath.replace(/(?:^|\/)index\.md$/, (m) => (m.startsWith('/') ? '/' : '')).replace(/\.md$/, '')}`;
}

/**
 * Check that every authored Markdown page under the docs root is linked from the sidebar config.
 * @param {{ docsDir: string, configSource: string }} input Docs root and the VitePress config source.
 * @returns {string[]} One violation per unlinked page.
 * @example
 * checkSidebarCoverage({ docsDir: '/repo/docs', configSource: readFileSync('/repo/docs/.vitepress/config.ts', 'utf8') });
 */
export function checkSidebarCoverage({ docsDir, configSource }) {
  const routes = sidebarRoutes(configSource);
  return markdownFiles(docsDir)
    .filter((file) => !routes.has(routeFor(file)))
    .map((file) => `docs/${file} is not linked from the sidebar (expected link: '${routeFor(file)}')`);
}

function htmlFiles(dir, root = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'assets' || entry.name === 'api' ? [] : htmlFiles(path, root);
    return entry.name.endsWith('.html') ? [relative(root, path).split('\\').join('/')] : [];
  });
}

/**
 * Check the built VitePress output for the agent artifacts: `llms.txt`, `llms-full.txt` and a `.md` twin per page.
 * @param {{ distDir: string }} input The VitePress `outDir`.
 * @returns {string[]} Violations, including a single entry when the dist directory is absent.
 * @example
 * checkDistAgentOutput({ distDir: '/repo/docs/.vitepress/dist' });
 */
export function checkDistAgentOutput({ distDir }) {
  if (!existsSync(distDir)) return [`missing built docs at ${distDir}; run pnpm docs:build first`];
  const violations = [];
  for (const name of ['llms.txt', 'llms-full.txt']) {
    if (!existsSync(join(distDir, name))) violations.push(`built docs lack ${name}`);
  }
  for (const html of htmlFiles(distDir)) {
    if (html === '404.html') continue;
    const twin = html.replace(/\.html$/, '.md');
    if (!existsSync(join(distDir, twin))) violations.push(`built docs lack the Markdown twin ${twin} for ${html}`);
  }
  return violations;
}

/**
 * Check that TypeDoc emitted a module page for every package.
 * @param {{ apiDir: string, packages: { name: string }[] }} input The TypeDoc `out` directory and the packages.
 * @returns {string[]} One violation per missing module page.
 * @example
 * checkTypeDocModules({ apiDir: '/repo/docs/api', packages: [{ name: '@kernl/guard' }] });
 */
export function checkTypeDocModules({ apiDir, packages }) {
  return packages
    .map((pkg) => join(apiDir, 'modules', typedocModuleFile(pkg.name)))
    .filter((file) => !existsSync(file) || !statSync(file).isFile())
    .map((file) => `TypeDoc module page missing: ${file}`);
}

/**
 * The URL path a built VitePress page is served at with `cleanUrls`: `index.html` maps to its directory, any other page drops `.html`.
 * @param {string} htmlPath Path of the built page relative to the dist directory, such as `packages/core.html`.
 * @param {string} base The VitePress base, with leading and trailing slash.
 * @returns {string} The served path, such as `/docs/packages/core`.
 * @example
 * servedPath('packages/index.html', '/docs/'); // '/docs/packages/'
 */
export function servedPath(htmlPath, base) {
  return `${base}${htmlPath.replace(/(?:^|\/)index\.html$/, (m) => (m.startsWith('/') ? '/' : '')).replace(/\.html$/, '')}`;
}

/**
 * Check that every `href` in the built docs that points into the TypeDoc output resolves, under the docs base, to a file that exists in `docs/api`.
 * An href points into the API reference when its path has an `api/` segment; external URLs and fragments are ignored.
 * @param {{ pages: { path: string, html: string }[], base: string, apiFileExists: (relativePath: string) => boolean }} input Built pages relative to the dist directory, the VitePress base and a lookup relative to `docs/api`.
 * @returns {string[]} One violation per href that escapes the base or names a missing file.
 * @example
 * checkApiHrefs({ pages: [{ path: 'packages/core.html', html: '<a href="../api/index.html">' }], base: '/docs/', apiFileExists: () => true }); // []
 */
export function checkApiHrefs({ pages, base, apiFileExists }) {
  const apiRoot = `${base}api/`;
  const violations = [];
  for (const page of pages) {
    const pageUrl = new URL(servedPath(page.path, base), 'https://docs.invalid');
    for (const match of page.html.matchAll(/\shref="([^"]*)"/g)) {
      const href = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) continue;
      const pathOnly = href.replace(/[?#].*$/, '');
      if (!/(?:^|\/)api\//.test(pathOnly)) continue;
      const { pathname } = new URL(pathOnly, pageUrl);
      if (!pathname.startsWith(apiRoot)) {
        violations.push(`${page.path}: href "${href}" resolves to ${pathname}, outside ${apiRoot}`);
        continue;
      }
      const target = decodeURIComponent(pathname.slice(apiRoot.length));
      if (!apiFileExists(target === '' || target.endsWith('/') ? `${target}index.html` : target)) {
        violations.push(`${page.path}: href "${href}" resolves to ${pathname}, which docs/api does not contain`);
      }
    }
  }
  return violations;
}

function builtPages(distDir) {
  if (!existsSync(distDir)) return [];
  return htmlFiles(distDir).map((path) => ({ path, html: readFileSync(join(distDir, path), 'utf8') }));
}

/**
 * Run every check against a repository root.
 * @param {string} repoRoot Absolute path of the repository.
 * @returns {string[]} All violations.
 * @example
 * auditDocs('/repo'); // []
 */
export function auditDocs(repoRoot) {
  const docsDir = join(repoRoot, 'docs');
  const packages = publicPackages(join(repoRoot, 'packages'));
  const configPath = join(docsDir, '.vitepress', 'config.ts');
  const configSource = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  return [
    ...(packages.length ? [] : ['no @kernl/* packages found under packages/']),
    ...(configSource ? [] : ['missing docs/.vitepress/config.ts']),
    ...checkPackagePages({ docsDir, packages }),
    ...checkSidebarCoverage({ docsDir, configSource }),
    ...checkDistAgentOutput({ distDir: join(docsDir, '.vitepress', 'dist') }),
    ...checkTypeDocModules({ apiDir: join(docsDir, 'api'), packages }),
    ...checkApiHrefs({
      pages: builtPages(join(docsDir, '.vitepress', 'dist')),
      base: process.env.VITEPRESS_BASE ?? '/docs/',
      apiFileExists: (relativePath) => existsSync(join(docsDir, 'api', relativePath)),
    }),
  ];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoRoot = resolve(new URL('..', import.meta.url).pathname);
  const violations = auditDocs(repoRoot);
  if (violations.length) {
    console.error(`[audit-docs] ${violations.length} violation(s):`);
    for (const violation of violations) console.error(`  - ${violation}`);
    process.exit(1);
  }
  console.log('[audit-docs] OK');
}
