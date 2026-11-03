import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { EXAMPLE_PATTERN, missingExamples, packageEntries } from './check-jsdoc.mjs';

const roots = [];
const doc = (summary) => `/**\n * ${summary}\n *\n * @example\n * \`\`\`ts\n * use();\n * \`\`\`\n */\n`;

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'check-jsdoc-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const check = (root, options = {}) => missingExamples({ packagesDir: join(root, 'packages'), ...options });

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('passes when every value export, re-exported or local, has a fenced example', () => {
  const root = fixture({
    'packages/a/src/index.ts': `${doc('Local.')}export const LOCAL = 1;\nexport { make, Thing } from './lib';\nexport * from './more';\n`,
    'packages/a/src/lib.ts': `${doc('Make.')}export function make() {}\n${doc('Thing.')}export class Thing {}\n`,
    'packages/a/src/more.ts': `${doc('Star.')}export const STAR = 'x';\nexport interface Shape { a: 1 }\n`,
  });
  expect(check(root)).toEqual([]);
});

test('fails with file:symbol at the declaration a re-export resolves to', () => {
  const root = fixture({
    'packages/a/src/index.ts': `export { LIMIT, make, Thing } from './lib';\nexport * from './more';\nexport const BARE = 1;\n`,
    'packages/a/src/lib.ts': `/** No example. */\nexport const LIMIT = 3;\n${doc('Make.')}export function make() {}\nexport class Thing {}\n`,
    'packages/a/src/more.ts': `export function star() {}\n`,
  });
  expect(check(root)).toEqual([
    'packages/a/src/index.ts:BARE',
    'packages/a/src/lib.ts:LIMIT',
    'packages/a/src/lib.ts:Thing',
    'packages/a/src/more.ts:star',
  ]);
});

test('an @example without a ts fence does not count', () => {
  const root = fixture({
    'packages/a/src/index.ts': `/**\n * Make.\n * @example\n * make();\n */\nexport function make() {}\n`,
  });
  expect(check(root)).toEqual(['packages/a/src/index.ts:make']);
});

test('type-only exports are skipped unless includeTypes is set', () => {
  const root = fixture({
    'packages/a/src/index.ts': `export type { Shape } from './types';\n`,
    'packages/a/src/types.ts': `/** No example. */\nexport interface Shape { a: 1 }\n`,
  });
  expect(check(root)).toEqual([]);
  expect(check(root, { includeTypes: true })).toEqual(['packages/a/src/types.ts:Shape']);
});

test('reports across packages, sorted, relative to the given root', () => {
  const root = fixture({
    'packages/b/src/index.ts': 'export const B = 1;\n',
    'packages/a/src/index.ts': 'export const A = 1;\n',
    'packages/no-src/package.json': '{}',
  });
  expect(check(root, { root: join(root, 'packages') })).toEqual(['a/src/index.ts:A', 'b/src/index.ts:B']);
});

test('packageEntries lists only packages with src/index.ts and tolerates a missing directory', () => {
  const root = fixture({ 'packages/a/src/index.ts': '', 'packages/c/README': '' });
  expect(packageEntries(join(root, 'packages'))).toEqual([join(root, 'packages/a/src/index.ts')]);
  expect(packageEntries(join(root, 'absent'))).toEqual([]);
  expect(check(fixture({}))).toEqual([]);
});

test('the example pattern needs the fence after the tag', () => {
  expect(EXAMPLE_PATTERN.test('@example\n * ```ts\n * a();')).toBe(true);
  expect(EXAMPLE_PATTERN.test('@example\n * ```typescript\n * a();')).toBe(true);
  expect(EXAMPLE_PATTERN.test('```ts\n * a();\n * ```\n * @example a();')).toBe(false);
});
