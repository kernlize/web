import { expect, test } from 'vitest';
import { extractSamples, mapDiagnostics, moduleName } from './check-doc-samples.mjs';

const page = (...lines) => lines.join('\n');

test('each ts block is one sample with its page lines', () => {
  const { samples, skipped, errors } = extractSamples(page('# Title', '', '```ts', 'const a = 1;', 'a;', '```'), 'x.md');
  expect(samples).toEqual([{ file: 'x.md', line: 3, code: 'const a = 1;\na;', lineMap: [4, 5] }]);
  expect(skipped).toEqual([]);
  expect(errors).toEqual([]);
});

test('typescript fences count, other languages do not', () => {
  const md = page('```bash', 'pnpm build', '```', '```typescript', 'let b = 2;', '```', '```json', '{}', '```');
  expect(extractSamples(md, 'x.md').samples.map((sample) => sample.code)).toEqual(['let b = 2;']);
});

test('a fence inside another language block is not a sample', () => {
  const md = page('````md', '```ts', 'broken(', '```', '````');
  expect(extractSamples(md, 'x.md').samples).toEqual([]);
});

test('sample:skip with a reason lists the block as partial', () => {
  const md = page('<!-- sample:skip shows one method of a larger object -->', '', '```ts', 'send() {}', '```');
  const { samples, skipped } = extractSamples(md, 'x.md');
  expect(samples).toEqual([]);
  expect(skipped).toEqual([{ file: 'x.md', line: 3, reason: 'shows one method of a larger object' }]);
});

test('sample:skip without a reason is not a marker', () => {
  const md = page('<!-- sample:skip -->', '```ts', 'const c = 3;', '```');
  expect(extractSamples(md, 'x.md').samples).toHaveLength(1);
});

test('sample:continues appends to the previous sample of the page', () => {
  const md = page('```ts', 'const a = 1;', '```', 'Then:', '<!-- sample:continues -->', '```ts', 'a + 1;', '```');
  const { samples } = extractSamples(md, 'x.md');
  expect(samples).toEqual([{ file: 'x.md', line: 1, code: 'const a = 1;\na + 1;', lineMap: [2, 7] }]);
});

test('sample:continues with nothing before it is an error', () => {
  const md = page('<!-- sample:continues -->', '```ts', 'a;', '```');
  expect(extractSamples(md, 'x.md').errors).toEqual(['x.md:2: sample:continues has no earlier sample on the page']);
});

test('generated module names are flat and unique per block', () => {
  expect(moduleName({ file: 'how-tos/deploy.md', line: 12 })).toBe('how-tos__deploy.md__L12.ts');
});

test('diagnostics map back to page lines; others are marked outside the samples', () => {
  const byModule = new Map([['x.md__L3.ts', { file: 'x.md', lineMap: [4, 5] }]]);
  const output = page(
    '/tmp/s/x.md__L3.ts(3,1): error TS2304: Cannot find name a.',
    '  detail line',
    '../packages/core/src/kernl.ts(1,1): error TS1: other',
  );
  expect(mapDiagnostics(output, byModule, 1)).toEqual([
    { sample: true, text: 'docs/x.md:5: error TS2304: Cannot find name a.\n  detail line' },
    { sample: false, text: '../packages/core/src/kernl.ts(1,1): error TS1: other' },
  ]);
});
