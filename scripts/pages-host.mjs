// The one statement of which file a request path gets from the production host. bunny.net static sites
// (D-019) serve an exact file, or a directory's index.html with or without the trailing slash, and
// nothing else: `/docs/decisions` does not fall back to `decisions.html`. The preview server and the
// link gate both resolve through this, so neither can be more forgiving than production.
import { cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const isFile = (file) => statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;

function decode(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

/**
 * Resolve a request path to the file the production host serves for it.
 * @param {string} root Artifact directory.
 * @param {string} pathname URL path relative to the site root, percent-encoded as it arrives.
 * @returns {string | null} The served file, or null when the host answers 404.
 * @example
 * servedFile('.pages', '/about');          // .pages/about/index.html
 * servedFile('.pages', '/docs/decisions'); // null unless docs/decisions/index.html exists
 */
export function servedFile(root, pathname) {
  const decoded = decode(pathname);
  if (decoded === null || decoded.includes('\0')) return null;
  const base = resolve(root);
  const target = resolve(base, `.${sep}${decoded}`);
  const inside = relative(base, target);
  if (inside === '..' || inside.startsWith(`..${sep}`)) return null;
  if (isFile(target)) return decoded.endsWith('/') ? null : target;
  const index = join(target, 'index.html');
  return isFile(index) ? index : null;
}

const isCleanUrlPage = (name) => name.endsWith('.html') && name !== 'index.html' && name !== '404.html';

/**
 * Make every `<page>.html` under a directory answer at `<page>` as well.
 * VitePress links to `/docs/<page>` and writes `<page>.html`; because the host never guesses an
 * extension, each page is also written as `<page>/index.html`, with its Markdown twin beside it.
 * @param {string} dir Directory of built pages.
 * @param {string[]} [skip] Directories whose links already carry `.html`.
 * @returns {number} How many pages were copied.
 * @example
 * writeCleanUrlCopies('.pages/docs', ['.pages/docs/api']); // docs/decisions.html is also docs/decisions/index.html
 */
export function writeCleanUrlCopies(dir, skip = []) {
  const skipped = new Set(skip.map((path) => resolve(path)));
  let copies = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) copies += skipped.has(resolve(path)) ? 0 : writeCleanUrlCopies(path, skip);
    else if (isCleanUrlPage(entry.name)) {
      const page = path.slice(0, -'.html'.length);
      if (existsSync(join(page, 'index.html'))) throw new Error(`${path} and ${join(page, 'index.html')} both claim the same address`);
      cpSync(path, join(page, 'index.html'));
      if (existsSync(`${page}.md`)) cpSync(`${page}.md`, join(page, 'index.md'));
      copies += 1;
    }
  }
  return copies;
}
