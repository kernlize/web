import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { auditSite, renderScorecard } from './audit-agent-readiness.mjs';

const description = 'A description that is long enough to count as a real summary of the page for search engines and agents alike, around one hundred and forty characters.';

const page = (body, head = '') => `<!doctype html><html lang="en"><head><title>kernl</title>
<meta name="description" content="${description}">
<link rel="canonical" href="https://example.test/">
<link rel="alternate" type="text/markdown" href="/index.md">
<meta property="og:title" content="kernl"><meta property="og:description" content="x"><meta property="og:type" content="website"><meta property="og:url" content="https://example.test/">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication","name":"kernl"}</script>
${head}</head><body>${body}</body></html>`;

const goodBody = `<main><h1>Hi</h1><h2>Two</h2><h3>Three</h3>
<form toolname="open-applet" tooldescription="Open"><label for="a">Address</label><input id="a" name="address" toolparamdescription="The address"><button>Go</button></form></main>`;

async function fixture(indexHtml, { twins = true, llm = 'same', robots = 'User-agent: *\nAllow: /\nSitemap: https://example.test/sitemap-index.xml\n' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'audit-'));
  await mkdir(path.join(dir, 'why'));
  await writeFile(path.join(dir, 'index.html'), indexHtml);
  await writeFile(path.join(dir, 'why', 'index.html'), page('<main><h1>Why</h1></main>'));
  if (twins) {
    await writeFile(path.join(dir, 'index.md'), '# kernl');
    await writeFile(path.join(dir, 'why', 'index.md'), '# Why');
  }
  const llms = '# kernl\n\n> summary\n\n## Pages\n\n- [Home](https://example.test/index.md)\n';
  await writeFile(path.join(dir, 'llms.txt'), llms);
  if (llm !== 'missing') await writeFile(path.join(dir, 'llm.txt'), llm === 'same' ? llms : llm);
  await writeFile(path.join(dir, 'llms-full.txt'), '# kernl\n');
  await writeFile(path.join(dir, 'robots.txt'), robots);
  await writeFile(path.join(dir, 'sitemap-index.xml'), '<sitemapindex/>');
  return dir;
}

const failing = (result) => result.checks.filter((check) => !check.ok).map((check) => check.name);

test('a complete site passes every check', async () => {
  const result = await auditSite(await fixture(page(goodBody)));
  expect(failing(result)).toEqual([]);
  expect(result.ok).toBe(true);
  expect(renderScorecard(result)).toMatch(/\d+\/\d+ checks passed$/);
});

test('names the failing checks', async () => {
  const broken = page('<main><h1>One</h1><h1>Two</h1><h4>Skipped</h4><form><input name="q"></form></main>');
  const result = await auditSite(await fixture(broken, { twins: false, robots: 'User-agent: *\nDisallow: /\n' }));
  expect(result.ok).toBe(false);
  expect(failing(result)).toEqual([
    'exactly one h1',
    'ordered heading levels',
    'WebMCP form (toolname, tooldescription)',
    'WebMCP input toolparamdescription',
    'every input labelled',
    'robots.txt with Sitemap and no Disallow: /',
    'markdown twin for every page',
  ]);
  expect(renderScorecard(result)).toContain('FAILED');
});

test('rejects invalid JSON-LD and a missing index', async () => {
  const bad = page(goodBody).replace('"@type":"WebApplication"', '"@type":"WebApplication",');
  expect(failing(await auditSite(await fixture(bad)))).toEqual(['JSON-LD WebApplication']);
  const empty = await mkdtemp(path.join(tmpdir(), 'audit-empty-'));
  expect(failing(await auditSite(empty))).toEqual(['index.html exists']);
});

test('the singular llm.txt must exist and match llms.txt', async () => {
  const missing = await auditSite(await fixture(page(goodBody), { llm: 'missing' }));
  expect(failing(missing)).toEqual(['llm.txt identical to llms.txt']);
  const different = await auditSite(await fixture(page(goodBody), { llm: '# other\n' }));
  expect(failing(different)).toEqual(['llm.txt identical to llms.txt']);
});
