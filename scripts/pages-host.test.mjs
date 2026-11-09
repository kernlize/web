import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { servedFile, writeCleanUrlCopies } from './pages-host.mjs';

async function site(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pages-host-'));
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), body);
  }
  return dir;
}

test('serves an exact file, and a directory index with or without the trailing slash', async () => {
  const dir = await site({ 'index.html': '', 'llms.txt': '', 'about/index.html': '' });
  expect(servedFile(dir, '/')).toBe(path.join(dir, 'index.html'));
  expect(servedFile(dir, '/llms.txt')).toBe(path.join(dir, 'llms.txt'));
  expect(servedFile(dir, '/about/')).toBe(path.join(dir, 'about', 'index.html'));
  expect(servedFile(dir, '/about')).toBe(path.join(dir, 'about', 'index.html'));
});

test('never guesses an extension: the production 404 that a friendlier preview hid', async () => {
  const dir = await site({ 'docs/decisions.html': '' });
  expect(servedFile(dir, '/docs/decisions.html')).toBe(path.join(dir, 'docs', 'decisions.html'));
  expect(servedFile(dir, '/docs/decisions')).toBeNull();
  expect(servedFile(dir, '/docs/decisions/')).toBeNull();
});

test('answers 404 for a file addressed as a directory, a directory without an index, and a missing path', async () => {
  const dir = await site({ 'llms.txt': '', 'assets/app.js': '' });
  expect(servedFile(dir, '/llms.txt/')).toBeNull();
  expect(servedFile(dir, '/assets/')).toBeNull();
  expect(servedFile(dir, '/nope')).toBeNull();
});

test('decodes the path and refuses anything outside the artifact', async () => {
  const dir = await site({ 'docs/a page.html': '', 'index.html': '' });
  expect(servedFile(dir, '/docs/a%20page.html')).toBe(path.join(dir, 'docs', 'a page.html'));
  expect(servedFile(dir, '/..%2f..%2fetc%2fpasswd')).toBeNull();
  expect(servedFile(dir, `/../${path.basename(dir)}-sibling/index.html`)).toBeNull();
  expect(servedFile(dir, '/%E0%A4%A')).toBeNull();
  expect(servedFile(dir, '/index.html%00')).toBeNull();
});

test('writes each page and its Markdown twin at the clean URL too', async () => {
  const dir = await site({
    'docs/index.html': 'home',
    'docs/404.html': 'missing',
    'docs/decisions.html': 'decisions',
    'docs/decisions.md': '# Decisions',
    'docs/concepts/guard.html': 'guard',
    'docs/api/modules/core.html': 'typedoc',
  });
  const docs = path.join(dir, 'docs');
  expect(writeCleanUrlCopies(docs, [path.join(docs, 'api')])).toBe(2);
  expect(servedFile(dir, '/docs/decisions')).toBe(path.join(docs, 'decisions', 'index.html'));
  expect(await readFile(path.join(docs, 'decisions', 'index.html'), 'utf8')).toBe('decisions');
  expect(await readFile(path.join(docs, 'decisions', 'index.md'), 'utf8')).toBe('# Decisions');
  expect(servedFile(dir, '/docs/concepts/guard')).toBe(path.join(docs, 'concepts', 'guard', 'index.html'));
  expect(existsSync(path.join(docs, 'concepts', 'guard', 'index.md'))).toBe(false);
  expect(existsSync(path.join(docs, '404'))).toBe(false);
  expect(existsSync(path.join(docs, 'index'))).toBe(false);
  expect(existsSync(path.join(docs, 'api', 'modules', 'core'))).toBe(false);
});

test('refuses to overwrite a page that already owns the clean URL', async () => {
  const dir = await site({ 'docs/packages.html': '', 'docs/packages/index.html': '' });
  expect(() => writeCleanUrlCopies(path.join(dir, 'docs'))).toThrow(/both claim the same address/);
});
