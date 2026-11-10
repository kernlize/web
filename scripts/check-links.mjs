// D-032: every link the built site carries must resolve under the production host's rules
// (scripts/pages-host.mjs), not the rules of a friendlier server. Internal links are resolved against the
// artifact, fragments included; `--live` asks the deployed origin for the same paths, so a host that
// resolves differently from pages-host.mjs fails the run; `--external` requests every outbound link.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { servedFile } from './pages-host.mjs';

const DEFAULT_SITE = new URL(process.env.SITE_BASE || '/', process.env.SITE_URL || 'https://kernl.run/').href;
const CONCURRENCY = 8;
const TIMEOUT_MS = 30_000;
const USER_AGENT = 'kernl-link-check (+https://kernl.run/)';
/** Names reserved for documentation and loopback (RFC 2606, RFC 6761): written in examples, never a destination. */
const RESERVED_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\]|example\.(?:com|org|net)|.+\.(?:example|test|invalid|localhost))$/i;
/** An outbound answer that proves the page is gone. Anything else unexpected (a rate limit, a bot wall, a timeout) is reported without failing. */
const GONE = new Set([404, 410]);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const TAG = /<[a-z][a-z0-9-]*(?:\s+(?:"[^"]*"|'[^']*'|[^>"'])*)?>/gi;
const attributes = (name) => new RegExp(`\\s(?:${name})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'gi');

function decodeEntities(value) {
  return value.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (entity, hex, decimal, name) => {
    if (hex || decimal) return String.fromCodePoint(hex ? Number.parseInt(hex, 16) : Number(decimal));
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** Comments and the bodies of script and style elements hold text that only looks like markup. */
function markupOnly(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/(<(script|style)\b[^>]*>)[\s\S]*?<\/\2>/gi, '$1');
}

/** A connection hint names an origin to warm up, not a document anyone opens. */
const isConnectionHint = (tag) => /^<link\b/i.test(tag) && /\srel\s*=\s*["']?[^"'>]*\b(?:preconnect|dns-prefetch)\b/i.test(tag);

function attributeValues(html, name) {
  const values = [];
  for (const tag of markupOnly(html).match(TAG) ?? []) {
    if (isConnectionHint(tag)) continue;
    for (const match of tag.matchAll(attributes(name))) values.push(decodeEntities(match[1] ?? match[2] ?? match[3]).trim());
  }
  return values;
}

/**
 * List the link targets in an HTML document.
 * @param {string} html Document source.
 * @returns {string[]} Every `href` and `src` value, entity-decoded, in document order.
 * @example
 * extractHtmlLinks('<a href="/docs/?a=1&amp;b=2">docs</a>'); // ['/docs/?a=1&b=2']
 */
export function extractHtmlLinks(html) {
  return attributeValues(html, 'href|src').filter(Boolean);
}

/**
 * List the fragment targets an HTML document defines.
 * @param {string} html Document source.
 * @returns {Set<string>} Every `id` and `name` value.
 * @example
 * extractAnchors('<h2 id="install">Install</h2>').has('install'); // true
 */
export function extractAnchors(html) {
  return new Set(attributeValues(html, 'id|name'));
}

/**
 * List the link targets in Markdown or plain text, ignoring code.
 * @param {string} text Markdown source.
 * @returns {string[]} Inline link destinations and autolinks.
 * @example
 * extractMarkdownLinks('See [the guard](https://kernl.run/docs/concepts/guard.md).'); // ['https://kernl.run/docs/concepts/guard.md']
 */
export function extractMarkdownLinks(text) {
  const prose = text.replace(/^(```|~~~)[\s\S]*?^\1.*$/gm, '').replace(/`[^`\n]*`/g, '');
  const inline = Array.from(prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g), (match) => match[1]);
  const auto = Array.from(prose.matchAll(/<(https?:\/\/[^>\s]+)>/g), (match) => match[1]);
  return [...inline, ...auto];
}

/**
 * List the addresses a sitemap advertises.
 * @param {string} xml Sitemap or sitemap index source.
 * @returns {string[]} Every `<loc>` value.
 * @example
 * extractSitemapLinks('<url><loc>https://kernl.run/about/</loc></url>'); // ['https://kernl.run/about/']
 */
export function extractSitemapLinks(xml) {
  return Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi), (match) => decodeEntities(match[1]));
}

const EXTRACTORS = { '.html': extractHtmlLinks, '.md': extractMarkdownLinks, '.txt': extractMarkdownLinks, '.xml': extractSitemapLinks };

async function listFiles(dir, prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(dir, relative)));
    else if (EXTRACTORS[path.extname(entry.name)]) files.push(relative);
  }
  return files.sort();
}

/**
 * build-pages.mjs copies `docs/<page>.html` to `docs/<page>/index.html`, and its Markdown twin with it, so
 * the clean URL is served. The copy is read at `/docs/<page>`, where its relative links resolve exactly as
 * the original's do, so the original is the one scanned; scanning the copy as `/docs/<page>/` would
 * misresolve every one of them.
 */
function isCleanUrlCopy(file, files) {
  const index = /\/index(\.html|\.md)$/.exec(file);
  return index !== null && files.has(`${path.posix.dirname(file)}${index[1]}`);
}

const pageUrl = (file, site) => new URL(file.replace(/(^|\/)index\.html$/, '$1'), site);

function resolveLink(raw, from, site) {
  let url;
  try {
    url = new URL(raw, from);
  } catch {
    return { kind: 'invalid' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'skipped' };
  if (url.origin === site.origin && url.pathname.startsWith(site.pathname)) return { kind: 'internal', url };
  return RESERVED_HOST.test(url.hostname) ? { kind: 'skipped' } : { kind: 'external', url };
}

function remember(map, key, file) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(file);
}

/**
 * Read every page of a built site and group its links by destination.
 * @param {string} dir Built site directory.
 * @param {URL} site The address the directory is served at.
 * @returns {Promise<{ pages: number, internal: Map<string, Set<string>>, external: Map<string, Set<string>>, invalid: Map<string, Set<string>> }>} Destinations, each with the files that link to it.
 * @example
 * const { internal } = await collectLinks('.pages', new URL('https://kernl.run/'));
 */
export async function collectLinks(dir, site) {
  const all = await listFiles(dir);
  const known = new Set(all);
  const files = all.filter((file) => !isCleanUrlCopy(file, known));
  const found = { pages: files.length, internal: new Map(), external: new Map(), invalid: new Map() };
  for (const file of files) {
    const text = await readFile(path.join(dir, file), 'utf8');
    const from = pageUrl(file, site);
    for (const raw of EXTRACTORS[path.extname(file)](text)) {
      const link = resolveLink(raw, from, site);
      if (link.kind === 'invalid') remember(found.invalid, raw, file);
      else if (link.kind !== 'skipped') remember(found[link.kind], link.url.href, file);
    }
  }
  return found;
}

const sitePath = (url, site) => `/${url.pathname.slice(site.pathname.length)}`;

function fragmentOf(url) {
  const raw = url.hash.slice(1);
  if (!raw || raw.startsWith(':~:')) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function internalChecker(dir, site) {
  const anchors = new Map();
  const anchorsOf = async (file) => {
    if (!anchors.has(file)) anchors.set(file, extractAnchors(await readFile(file, 'utf8')));
    return anchors.get(file);
  };
  return async (href) => {
    const url = new URL(href);
    const file = servedFile(dir, sitePath(url, site));
    if (!file) return 'the host serves no file for this path';
    const fragment = fragmentOf(url);
    if (!fragment || !file.endsWith('.html')) return null;
    return (await anchorsOf(file)).has(fragment) ? null : `the page has no element with id "${fragment}"`;
  };
}

async function request(href, fetchImpl) {
  try {
    const response = await fetchImpl(href, { redirect: 'follow', headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    await response.body?.cancel();
    return { status: response.status };
  } catch (error) {
    return { error: error.cause?.code ?? error.name };
  }
}

const settled = (answer) => answer.status !== undefined && answer.status < 500 && answer.status !== 429;

/** One retry: a second answer separates a host that is down from one that hiccupped. */
async function probe(href, fetchImpl) {
  const first = await request(href, fetchImpl);
  return settled(first) ? first : request(href, fetchImpl);
}

const describe = (answer) => (answer.status === undefined ? answer.error : `HTTP ${answer.status}`);

async function pool(items, worker) {
  const queue = [...items];
  const run = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await worker(item);
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
}

async function checkLive({ internal, site, live, fetchImpl }, report) {
  const paths = new Map();
  for (const [href, files] of internal) {
    const url = new URL(href);
    const target = new URL(`.${sitePath(url, site)}${url.search}`, live).href;
    for (const file of files) remember(paths, target, file);
  }
  await pool(paths, async ([target, files]) => {
    const answer = await probe(target, fetchImpl);
    if (answer.status !== 200) report.broken.push({ url: target, reason: `the live site answered ${describe(answer)}`, files: [...files] });
  });
}

async function checkExternal({ external, fetchImpl }, report) {
  const targets = new Map();
  for (const [href, files] of external) {
    const url = new URL(href);
    url.hash = '';
    for (const file of files) remember(targets, url.href, file);
  }
  await pool(targets, async ([target, files]) => {
    const answer = await probe(target, fetchImpl);
    if (answer.status >= 200 && answer.status < 300) return;
    const gone = GONE.has(answer.status) || answer.error === 'ENOTFOUND';
    report[gone ? 'broken' : 'unverified'].push({ url: target, reason: describe(answer), files: [...files] });
  });
}

/**
 * Check every link in a built site.
 * @param {object} options What to check.
 * @param {string} options.dir Built site directory.
 * @param {string} [options.site] The address the directory is served at.
 * @param {string} [options.live] A deployed origin to ask for every internal path as well.
 * @param {boolean} [options.external] Request outbound links too.
 * @param {typeof fetch} [options.fetch] The fetch used for `live` and `external`.
 * @returns {Promise<{ ok: boolean, pages: number, internal: number, external: number, broken: { url: string, reason: string, files: string[] }[], unverified: { url: string, reason: string, files: string[] }[] }>} Broken links fail the run; unverified ones are outbound links that neither answered nor proved gone.
 * @example
 * const result = await checkSite({ dir: '.pages', live: 'https://kernl.run/' });
 * if (!result.ok) process.exit(1);
 */
export async function checkSite({ dir, site = DEFAULT_SITE, live, external = false, fetch: fetchImpl = globalThis.fetch }) {
  const base = new URL(site);
  const links = await collectLinks(dir, base);
  const report = { broken: [], unverified: [] };
  for (const [raw, files] of links.invalid) report.broken.push({ url: raw, reason: 'not a valid address', files: [...files] });
  const check = internalChecker(dir, base);
  for (const [href, files] of links.internal) {
    const reason = await check(href);
    if (reason) report.broken.push({ url: href, reason, files: [...files] });
  }
  if (live) await checkLive({ internal: links.internal, site: base, live, fetchImpl }, report);
  if (external) await checkExternal({ external: links.external, fetchImpl }, report);
  const byUrl = (a, b) => a.url.localeCompare(b.url);
  return { ok: report.broken.length === 0, pages: links.pages, internal: links.internal.size, external: links.external.size, broken: report.broken.sort(byUrl), unverified: report.unverified.sort(byUrl) };
}

const SHOWN_FILES = 3;

function renderEntry(label, { url, reason, files }) {
  const more = files.length > SHOWN_FILES ? ` (+${files.length - SHOWN_FILES} more)` : '';
  return `${label}  ${url}\n    ${reason}\n    linked from ${files.slice(0, SHOWN_FILES).join(', ')}${more}`;
}

/**
 * Render a result for a terminal or a CI log.
 * @param {Awaited<ReturnType<typeof checkSite>>} result The result of `checkSite`.
 * @returns {string} One block per broken or unverified link, then a summary line.
 * @example
 * console.log(renderReport(await checkSite({ dir: '.pages' })));
 */
export function renderReport(result) {
  const blocks = [...result.unverified.map((entry) => renderEntry('UNVERIFIED', entry)), ...result.broken.map((entry) => renderEntry('BROKEN', entry))];
  const unverified = result.unverified.length ? `, ${result.unverified.length} outbound unverified` : '';
  const summary = `${result.pages} files, ${result.internal} internal and ${result.external} outbound destinations: ${result.broken.length} broken${unverified}`;
  return [...blocks, summary].join('\n');
}

async function main() {
  const { values } = parseArgs({ options: { dir: { type: 'string', default: '.pages' }, site: { type: 'string', default: DEFAULT_SITE }, live: { type: 'string' }, external: { type: 'boolean', default: false } } });
  const result = await checkSite(values);
  const scope = [values.dir, values.live && `live ${values.live}`, values.external && 'outbound'].filter(Boolean).join(', ');
  process.stdout.write(`links: ${scope}\n\n${renderReport(result)}\n`);
  if (!result.ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
