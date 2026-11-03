// D-007: the built site must carry every agent-discovery artifact. Checks the dist and prints a scorecard.
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DESCRIPTION_RANGE = [120, 170];

const attribute = (tag, name) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
const tags = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) ?? [];
const metaContent = (html, key, value) => tags(html, 'meta').map((tag) => (attribute(tag, key) === value ? attribute(tag, 'content') : undefined)).find(Boolean);

function headingLevels(html) {
  return Array.from(html.matchAll(/<h([1-6])\b/gi), (match) => Number(match[1]));
}

function headingsOrdered(levels) {
  return levels.every((level, index) => index === 0 || level <= levels[index - 1] + 1);
}

function jsonLdTypes(html) {
  const blocks = Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi), (match) => match[1]);
  const types = [];
  for (const block of blocks) {
    try {
      const data = JSON.parse(block);
      types.push(...[data].flat().map((item) => item['@type']));
    } catch {
      types.push('<invalid>');
    }
  }
  return types;
}

function inputLabelled(input, html) {
  const type = (attribute(input, 'type') ?? 'text').toLowerCase();
  if (type === 'hidden' || type === 'submit' || type === 'button') return true;
  if (attribute(input, 'aria-label') || attribute(input, 'aria-labelledby')) return true;
  const id = attribute(input, 'id');
  if (id && new RegExp(`<label\\b[^>]*\\bfor=["']${id}["']`, 'i').test(html)) return true;
  const index = html.indexOf(input);
  const before = html.slice(0, index);
  return before.lastIndexOf('<label') > before.lastIndexOf('</label>');
}

function indexChecks(html) {
  const description = metaContent(html, 'name', 'description') ?? '';
  const levels = headingLevels(html);
  const types = jsonLdTypes(html);
  const forms = tags(html, 'form');
  const inputs = tags(html, 'input');
  const form = forms.find((tag) => attribute(tag, 'toolname') && attribute(tag, 'tooldescription'));
  return [
    ['html lang', /<html\b[^>]*\blang=["'][a-z-]+["']/i.test(html)],
    ['title', /<title>[^<]+<\/title>/i.test(html)],
    ['meta description 120-170 chars', description.length >= DESCRIPTION_RANGE[0] && description.length <= DESCRIPTION_RANGE[1], `${description.length} chars`],
    ['canonical link', tags(html, 'link').some((tag) => attribute(tag, 'rel') === 'canonical' && attribute(tag, 'href'))],
    ['og:title', Boolean(metaContent(html, 'property', 'og:title'))],
    ['og:description', Boolean(metaContent(html, 'property', 'og:description'))],
    ['og:type', Boolean(metaContent(html, 'property', 'og:type'))],
    ['og:url', Boolean(metaContent(html, 'property', 'og:url'))],
    ['twitter:card', Boolean(metaContent(html, 'name', 'twitter:card'))],
    ['JSON-LD WebApplication', types.includes('WebApplication'), types.join(', ') || 'none'],
    ['exactly one h1', levels.filter((level) => level === 1).length === 1, `${levels.filter((level) => level === 1).length} found`],
    ['ordered heading levels', headingsOrdered(levels), levels.join(' ')],
    ['WebMCP form (toolname, tooldescription)', Boolean(form)],
    ['WebMCP input toolparamdescription', inputs.some((tag) => attribute(tag, 'toolparamdescription'))],
    ['every input labelled', inputs.every((tag) => inputLabelled(tag, html)), `${inputs.length} inputs`],
    ['markdown alternate link', tags(html, 'link').some((tag) => attribute(tag, 'rel') === 'alternate' && attribute(tag, 'type') === 'text/markdown')],
  ];
}

async function readIfExists(file) {
  return existsSync(file) ? readFile(file, 'utf8') : null;
}

async function fileChecks(dir) {
  const llms = await readIfExists(path.join(dir, 'llms.txt'));
  const robots = await readIfExists(path.join(dir, 'robots.txt'));
  const full = await stat(path.join(dir, 'llms-full.txt')).catch(() => null);
  return [
    ['llms.txt with H1 and a section', Boolean(llms && /^# .+/m.test(llms) && /^## .+/m.test(llms))],
    ['llms-full.txt', Boolean(full?.isFile() && full.size > 0)],
    ['robots.txt with Sitemap and no Disallow: /', Boolean(robots && /^Sitemap:\s*\S+/m.test(robots) && !/^Disallow:\s*\/\s*$/m.test(robots))],
    ['sitemap-index.xml', existsSync(path.join(dir, 'sitemap-index.xml'))],
  ];
}

async function htmlPages(dir, prefix = '') {
  const pages = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) pages.push(...(await htmlPages(dir, relative)));
    else if (entry.name === 'index.html') pages.push(relative);
  }
  return pages.sort();
}

async function twinChecks(dir) {
  const pages = await htmlPages(dir);
  const missing = pages.filter((page) => !existsSync(path.join(dir, path.dirname(page), 'index.md')));
  return [['markdown twin for every page', pages.length > 0 && missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${pages.length} pages`]];
}

/**
 * Audit a built site directory for agent-discovery artifacts.
 * @param {string} dir Built site directory.
 * @returns {Promise<{ ok: boolean, checks: { name: string, ok: boolean, detail: string }[] }>} The scorecard.
 */
export async function auditSite(dir) {
  const index = await readIfExists(path.join(dir, 'index.html'));
  const rows = index ? [...indexChecks(index), ...(await fileChecks(dir)), ...(await twinChecks(dir))] : [['index.html exists', false]];
  const checks = rows.map(([name, ok, detail = '']) => ({ name, ok: Boolean(ok), detail }));
  return { ok: checks.every((check) => check.ok), checks };
}

export function renderScorecard({ ok, checks }) {
  const width = Math.max(...checks.map((check) => check.name.length));
  const lines = checks.map((check) => `${check.ok ? 'PASS' : 'FAIL'}  ${check.name.padEnd(width)}  ${check.detail}`.trimEnd());
  const passed = checks.filter((check) => check.ok).length;
  return [...lines, '', `${passed}/${checks.length} checks passed${ok ? '' : ' — agent readiness FAILED'}`].join('\n');
}

export function defaultDistDir() {
  return existsSync('.pages') ? '.pages' : path.join('apps', 'web', 'dist');
}

async function main() {
  const dir = process.argv[2] ?? defaultDistDir();
  const result = await auditSite(dir);
  process.stdout.write(`agent readiness: ${dir}\n\n${renderScorecard(result)}\n`);
  if (!result.ok) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
