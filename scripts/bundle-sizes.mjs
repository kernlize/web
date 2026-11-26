#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

/** The page the table lives in, between {@link START} and {@link END}. */
export const PAGE = 'docs/concepts/kernel-modules-and-presets.md';
export const START = '<!-- bundle-sizes:start -->';
export const END = '<!-- bundle-sizes:end -->';

/**
 * The hosts measured, each the smallest program that composes its shell. They are bundled from the
 * built packages, resolved from `apps/web` as any host's own dependencies would be.
 */
export const HOSTS = [
  {
    name: 'The kernel alone',
    what: '`createKernel` with no modules',
    source: "import { createKernel } from '@kernlize/kernel';\nexport const compose = (host) => createKernel({ host, modules: [] });",
  },
  {
    name: 'The example host',
    what: 'the kernel, messaging with `privateDm()`, and files, as `examples/minimal-host` composes them',
    source: [
      "import { createKernel } from '@kernlize/kernel';",
      "import { messagingModule, privateDm } from '@kernlize/modules/messaging';",
      "import { filesModule } from '@kernlize/modules/uploads';",
      'export const compose = (host) => createKernel({ host, modules: [messagingModule({ providers: [privateDm()] }), filesModule()] });',
    ].join('\n'),
  },
  {
    name: "kernl's preset",
    what: '`createKernl`, which loads all eighteen of kernl.run\'s modules',
    source: "import { createKernl } from '@kernlize/preset';\nexport const compose = (host) => createKernl({ host });",
  },
];

/**
 * Kilobytes, to one decimal.
 * @param {number} bytes A size in bytes.
 * @returns {string} Such as `412.3 KB`.
 * @example
 * kilobytes(2048); // '2.0 KB'
 */
export function kilobytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * The table, as Markdown.
 * @param {{ name: string, what: string, minified: number, gzipped: number }[]} rows One measured host per row.
 * @returns {string} A header, a rule and one line per row.
 * @example
 * renderTable([{ name: 'A', what: 'b', minified: 2048, gzipped: 1024 }]).split('\n')[2]; // '| A | b | 2.0 KB | 1.0 KB |'
 */
export function renderTable(rows) {
  return [
    '| Host | What it composes | Minified | Gzipped |',
    '| --- | --- | ---: | ---: |',
    ...rows.map((row) => `| ${row.name} | ${row.what} | ${kilobytes(row.minified)} | ${kilobytes(row.gzipped)} |`),
  ].join('\n');
}

/**
 * Put a table between the markers of a page.
 * @param {string} page The page's Markdown.
 * @param {string} table The table to put there.
 * @returns {string} The page with the table in place.
 * @throws {Error} `invalid:bundle-sizes-markers` when the page lacks either marker.
 * @example
 * withTable(`a\n${START}\nold\n${END}\nb`, 'new'); // `a\n${START}\nnew\n${END}\nb`
 */
export function withTable(page, table) {
  const start = page.indexOf(START);
  const end = page.indexOf(END);
  if (start === -1 || end < start) throw new Error('invalid:bundle-sizes-markers');
  return `${page.slice(0, start + START.length)}\n${table}\n${page.slice(end)}`;
}

const ROW = /^\| (.+?) \| .+? \| ([\d.]+) KB \| ([\d.]+) KB \|$/;

/**
 * The sizes in a table, by host.
 * @param {string} page Markdown holding a table {@link renderTable} wrote.
 * @returns {Map<string, { minified: number, gzipped: number }>} Kilobytes as written, by host name.
 * @example
 * sizesIn('| A | b | 2.0 KB | 1.0 KB |').get('A'); // { minified: 2, gzipped: 1 }
 */
export function sizesIn(page) {
  const sizes = new Map();
  for (const line of page.split('\n')) {
    const match = ROW.exec(line);
    if (match) sizes.set(match[1], { minified: Number(match[2]), gzipped: Number(match[3]) });
  }
  return sizes;
}

/**
 * Whether a page's table still says what was measured. Minified sizes come from one pinned
 * esbuild and must match exactly; gzip differs a little between the zlib builds Node ships, so a
 * gzipped size may be off by 1%.
 * @param {string} page The page as it is.
 * @param {string} measured The page as it would be written now.
 * @returns {boolean} True when nothing a reader relies on has changed.
 * @example
 * isCurrent('| A | b | 2.0 KB | 1.00 KB |', '| A | b | 2.0 KB | 1.01 KB |'); // true
 */
export function isCurrent(page, measured) {
  const written = sizesIn(page);
  const now = sizesIn(measured);
  if (written.size !== now.size || page.replace(/[\d.]+ KB/g, '') !== measured.replace(/[\d.]+ KB/g, '')) return false;
  return [...now].every(([name, size]) => {
    const was = written.get(name);
    return was !== undefined && was.minified === size.minified && Math.abs(was.gzipped - size.gzipped) <= size.gzipped * 0.01;
  });
}

/**
 * Bundle each host for the browser, minified, and measure what a browser downloads.
 * @param {string} repoRoot Absolute path of the repository, with the packages built.
 * @returns {Promise<{ name: string, what: string, minified: number, gzipped: number }[]>} One row per host, in {@link HOSTS} order.
 */
export async function measure(repoRoot) {
  const { build } = await import('esbuild');
  const rows = [];
  for (const host of HOSTS) {
    const result = await build({
      stdin: { contents: host.source, resolveDir: join(repoRoot, 'apps/web'), loader: 'js' },
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      splitting: false,
      write: false,
      outdir: 'out',
      logLevel: 'silent',
    });
    const code = Buffer.concat(result.outputFiles.filter((file) => file.path.endsWith('.js')).map((file) => Buffer.from(file.contents)));
    rows.push({ name: host.name, what: host.what, minified: code.length, gzipped: gzipSync(code, { level: 9 }).length });
  }
  return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve(new URL('..', import.meta.url).pathname);
  const path = join(root, PAGE);
  const before = readFileSync(path, 'utf8');
  const after = withTable(before, renderTable(await measure(root)));
  if (process.argv.includes('--check')) {
    if (!isCurrent(before, after)) {
      console.error(`[bundle-sizes] ${PAGE} is out of date; run node scripts/bundle-sizes.mjs`);
      process.exit(1);
    }
    console.log('[bundle-sizes] up to date');
  } else {
    writeFileSync(path, after);
    console.log(after === before ? '[bundle-sizes] up to date' : `[bundle-sizes] updated ${PAGE}`);
  }
}
