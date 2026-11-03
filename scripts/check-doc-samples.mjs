#!/usr/bin/env node
// Type-checks every ```ts block in docs/**/*.md against the package sources, so a sample that stops compiling fails `pnpm docs:check`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** `<!-- sample:skip <reason> -->` before a fence: the block is an intentional fragment and is not compiled. The reason is required. */
export const SKIP_MARKER = /^<!--\s*sample:skip\s+(.+?)\s*-->$/;
/** `<!-- sample:continues -->` before a fence: the block is appended to the previous checked block on the same page, as one module. */
export const CONTINUES_MARKER = /^<!--\s*sample:continues\s*-->$/;
const FENCE_OPEN = /^```(ts|typescript)\b/;
const FENCE_CLOSE = /^```\s*$/;
const ANY_FENCE = /^```/;

/**
 * Find the marker comment that applies to a fence: the nearest non-blank line above it.
 * @param {string[]} lines Page lines.
 * @param {number} fenceIndex Zero-based index of the opening fence.
 * @returns {string} The trimmed line, or '' when the fence is the first content.
 */
function markerAbove(lines, fenceIndex) {
  for (let index = fenceIndex - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line !== '') return line;
  }
  return '';
}

/**
 * Extract the TypeScript samples of one Markdown page.
 *
 * Each ```ts block becomes one sample unless the line above it (blank lines aside) is
 * `<!-- sample:skip <reason> -->`, which lists it under `skipped`, or `<!-- sample:continues -->`,
 * which appends it to the previous sample of the page. `lineMap[i]` is the 1-based page line of
 * the sample's line `i + 1`.
 * @param {string} markdown Page source.
 * @param {string} file Page path used in results.
 * @returns {{ samples: { file: string, line: number, code: string, lineMap: number[] }[], skipped: { file: string, line: number, reason: string }[], errors: string[] }} The page's samples.
 * @example
 * extractSamples('```ts\nconst a = 1;\n```\n', 'x.md').samples[0].code; // 'const a = 1;'
 */
export function extractSamples(markdown, file) {
  const lines = markdown.split('\n');
  const samples = [];
  const skipped = [];
  const errors = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!ANY_FENCE.test(line)) {
      index += 1;
      continue;
    }
    const isTs = FENCE_OPEN.test(line);
    const start = index;
    let end = index + 1;
    while (end < lines.length && !FENCE_CLOSE.test(lines[end])) end += 1;
    index = end + 1;
    if (!isTs) continue;
    const body = lines.slice(start + 1, end);
    const lineMap = body.map((_, offset) => start + 2 + offset);
    const marker = markerAbove(lines, start);
    const skip = marker.match(SKIP_MARKER);
    if (skip) {
      skipped.push({ file, line: start + 1, reason: skip[1] });
    } else if (CONTINUES_MARKER.test(marker)) {
      const previous = samples.at(-1);
      if (previous) {
        previous.code = `${previous.code}\n${body.join('\n')}`;
        previous.lineMap.push(...lineMap);
      } else {
        errors.push(`${file}:${start + 1}: sample:continues has no earlier sample on the page`);
      }
    } else {
      samples.push({ file, line: start + 1, code: body.join('\n'), lineMap });
    }
  }
  return { samples, skipped, errors };
}

/**
 * List the Markdown pages under the docs root, skipping build output, the generated API reference and dependencies.
 * @param {string} dir Directory to scan.
 * @param {string} root Docs root, for relative paths.
 * @returns {string[]} Paths relative to `root`, sorted.
 */
export function docPages(dir, root = dir) {
  const skip = new Set(['.vitepress', 'api', 'node_modules', 'public']);
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return skip.has(entry.name) ? [] : docPages(full, root);
      return entry.name.endsWith('.md') ? [relative(root, full).split('\\').join('/')] : [];
    })
    .sort();
}

/**
 * Name the generated module for a sample.
 * @param {{ file: string, line: number }} sample The sample.
 * @returns {string} A file name such as `how-tos__deploy.md__L12.ts`.
 * @example
 * moduleName({ file: 'how-tos/deploy.md', line: 12 }); // 'how-tos__deploy.md__L12.ts'
 */
export function moduleName(sample) {
  return `${sample.file.replace(/[^\w.-]/g, '__')}__L${sample.line}.ts`;
}

/**
 * Map tsc diagnostics on generated modules back to Markdown lines.
 * @param {string} output `tsc --pretty false` output.
 * @param {Map<string, { file: string, lineMap: number[] }>} byModule Samples keyed by generated file name.
 * @param {number} headerLines Lines the generator put before the sample code.
 * @returns {{ sample: boolean, text: string }[]} One entry per diagnostic, continuation lines folded in; `sample` is false for diagnostics outside the generated modules.
 * @example
 * mapDiagnostics('x__L1.ts(2,1): error TS2304: nope', new Map([['x__L1.ts', { file: 'x.md', lineMap: [2] }]]), 1);
 * // [{ sample: true, text: 'docs/x.md:2: error TS2304: nope' }]
 */
export function mapDiagnostics(output, byModule, headerLines) {
  const entries = [];
  for (const line of output.split('\n')) {
    if (line.trim() === '') continue;
    const match = line.match(/([^/\\(]+\.ts)\((\d+),\d+\): (.*)$/);
    if (match) {
      const sample = byModule.get(match[1]);
      const pageLine = sample ? (sample.lineMap[Number(match[2]) - headerLines - 1] ?? sample.lineMap[0]) : 0;
      entries.push({ sample: Boolean(sample), text: sample ? `docs/${sample.file}:${pageLine}: ${match[3]}` : line.trim() });
    } else if (entries.length > 0) {
      entries.at(-1).text += `\n${line}`;
    } else {
      entries.push({ sample: false, text: line });
    }
  }
  return entries;
}

/**
 * Give the scratch directory a node_modules that resolves like a package of the workspace:
 * the root's dependencies plus @kernl/core's (kehto, applesauce, rxjs), the latter winning.
 * @param {string} repo Repository root.
 * @param {string} dir Scratch directory.
 */
function linkNodeModules(repo, dir) {
  const target = join(dir, 'node_modules');
  mkdirSync(target);
  for (const source of [join(repo, 'node_modules'), join(repo, 'packages', 'core', 'node_modules')]) {
    for (const entry of readdirSync(source)) {
      if (entry.startsWith('.') || entry === '@kernl') continue;
      if (entry.startsWith('@')) {
        mkdirSync(join(target, entry), { recursive: true });
        for (const child of readdirSync(join(source, entry))) {
          rmSync(join(target, entry, child), { force: true, recursive: true });
          symlinkSync(join(source, entry, child), join(target, entry, child));
        }
      } else {
        rmSync(join(target, entry), { force: true, recursive: true });
        symlinkSync(join(source, entry), join(target, entry));
      }
    }
  }
}

const HEADER = 'export {};\n';

async function main() {
  const repo = resolve(import.meta.dirname, '..');
  const docsDir = join(repo, 'docs');
  const pages = docPages(docsDir);
  const results = pages.map((page) => extractSamples(readFileSync(join(docsDir, page), 'utf8'), page));
  const samples = results.flatMap((result) => result.samples);
  const skipped = results.flatMap((result) => result.skipped);
  const markerErrors = results.flatMap((result) => result.errors);
  if (markerErrors.length) {
    for (const error of markerErrors) console.error(`docs/${error}`);
    process.exit(1);
  }

  const dir = mkdtempSync(join(tmpdir(), 'kernl-doc-samples-'));
  try {
    linkNodeModules(repo, dir);
    const byModule = new Map();
    for (const sample of samples) {
      const name = moduleName(sample);
      byModule.set(name, sample);
      writeFileSync(join(dir, name), `${HEADER}${sample.code}\n`);
    }
    const paths = Object.fromEntries(
      readdirSync(join(repo, 'packages'))
        .filter((slug) => existsSync(join(repo, 'packages', slug, 'src', 'index.ts')))
        .map((slug) => [`@kernl/${slug}`, [join(repo, 'packages', slug, 'src', 'index.ts')]]),
    );
    const tsconfig = {
      extends: join(repo, 'tsconfig.base.json'),
      // A consumer's settings, not the packages' own: applesauce's account classes are not clean under exactOptionalPropertyTypes.
      compilerOptions: {
        noEmit: true,
        declaration: false,
        declarationMap: false,
        sourceMap: false,
        exactOptionalPropertyTypes: false,
        moduleDetection: 'force',
        types: [],
        paths,
      },
      include: ['*.ts'],
    };
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
    const tsc = createRequire(join(repo, 'package.json')).resolve('typescript/bin/tsc');
    const run = spawnSync(process.execPath, [tsc, '--project', join(dir, 'tsconfig.json'), '--pretty', 'false'], { cwd: dir, encoding: 'utf8' });
    const diagnostics = mapDiagnostics(`${run.stdout}${run.stderr}`, byModule, HEADER.split('\n').length - 1);
    const inSamples = diagnostics.filter((entry) => entry.sample);
    // Errors inside packages/*/src are `pnpm type-check`'s to report; here they are only a warning.
    for (const entry of diagnostics.filter((item) => !item.sample)) console.warn(`warning (outside the samples): ${entry.text}`);
    if (inSamples.length > 0 || (run.status !== 0 && diagnostics.length === 0)) {
      for (const entry of inSamples) console.error(entry.text);
      console.error(`\ndoc samples: type-check failed (${samples.length} checked)`);
      process.exit(1);
    }
    process.stdout.write(`doc samples: ${samples.length} type-checked, ${skipped.length} marked partial\n`);
    for (const entry of skipped) process.stdout.write(`  partial docs/${entry.file}:${entry.line}  ${entry.reason}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
