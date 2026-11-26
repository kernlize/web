import { expect, test } from 'vitest';
import { END, START, isCurrent, kilobytes, renderTable, sizesIn, withTable } from './bundle-sizes.mjs';

const rows = [
  { name: 'The kernel alone', what: '`createKernel`', minified: 600_000, gzipped: 200_000 },
  { name: "kernl's preset", what: '`createKernl`', minified: 1_800_000, gzipped: 550_000 },
];
const page = (table) => `# Page\n\n${START}\n${table}\n${END}\n\nAfter.\n`;

test('sizes are written in kilobytes to one decimal', () => {
  expect(kilobytes(2048)).toBe('2.0 KB');
  expect(kilobytes(600_000)).toBe('585.9 KB');
});

test('the table has one row per host, sizes right-aligned', () => {
  expect(renderTable(rows).split('\n')).toEqual([
    '| Host | What it composes | Minified | Gzipped |',
    '| --- | --- | ---: | ---: |',
    '| The kernel alone | `createKernel` | 585.9 KB | 195.3 KB |',
    "| kernl's preset | `createKernl` | 1757.8 KB | 537.1 KB |",
  ]);
});

test('the table replaces whatever is between the markers and nothing else', () => {
  expect(withTable(page('old'), 'new')).toBe(page('new'));
});

test('a page without the markers is refused', () => {
  expect(() => withTable('# Page\n', 'new')).toThrow('invalid:bundle-sizes-markers');
});

test('the sizes are read back by host', () => {
  expect(sizesIn(renderTable(rows)).get('The kernel alone')).toEqual({ minified: 585.9, gzipped: 195.3 });
});

test('a table that matches what was measured is current', () => {
  expect(isCurrent(page(renderTable(rows)), page(renderTable(rows)))).toBe(true);
});

test('gzip a little off, as another zlib writes it, is still current', () => {
  const zlib = rows.map((row) => ({ ...row, gzipped: row.gzipped + 1000 }));
  expect(isCurrent(page(renderTable(rows)), page(renderTable(zlib)))).toBe(true);
});

test('a minified size that changed by one tenth of a kilobyte is not current', () => {
  const grown = rows.map((row, index) => (index === 0 ? { ...row, minified: row.minified + 200 } : row));
  expect(isCurrent(page(renderTable(rows)), page(renderTable(grown)))).toBe(false);
});

test('gzip more than 1% off is not current', () => {
  const grown = rows.map((row) => ({ ...row, gzipped: row.gzipped * 1.05 }));
  expect(isCurrent(page(renderTable(rows)), page(renderTable(grown)))).toBe(false);
});

test('a host added, removed or reworded is not current', () => {
  expect(isCurrent(page(renderTable(rows)), page(renderTable(rows.slice(0, 1))))).toBe(false);
  expect(isCurrent(page(renderTable(rows)), page(renderTable([{ ...rows[0], what: 'other' }, rows[1]])))).toBe(false);
});
