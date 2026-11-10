import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { checkSite, extractAnchors, extractHtmlLinks, extractMarkdownLinks, extractSitemapLinks, renderReport } from './check-links.mjs';
import { servedFile, writeCleanUrlCopies } from './pages-host.mjs';

const SITE = 'https://kernl.run/';

async function site(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'links-'));
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), body);
  }
  return dir;
}

const broken = async (files, options = {}) => (await checkSite({ dir: await site(files), site: SITE, ...options })).broken.map((entry) => `${entry.url} | ${entry.reason}`);

/** A loopback host that answers by the production rules, so the live path is a real request. */
async function host(dir) {
  const server = createServer((request, response) => {
    const file = servedFile(dir, new URL(request.url, 'http://host').pathname);
    if (!file) return response.writeHead(404).end();
    response.writeHead(200);
    return createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('reads href and src from markup, decoding entities', () => {
  const html = `<a href="/docs/?a=1&amp;b=2">x</a><img src='og.png'><script src=/_astro/app.js></script><a href=" ./why/ ">y</a><a>no target</a>`;
  expect(extractHtmlLinks(html)).toEqual(['/docs/?a=1&b=2', 'og.png', '/_astro/app.js', './why/']);
  expect(extractHtmlLinks('<a href="/a&#47;b&#x2F;c&nbsp;d">x</a>')).toEqual(['/a/b/c&nbsp;d']);
});

test('ignores text that only looks like markup, data attributes and connection hints', () => {
  const html = `<!-- <a href="/commented"> --><script>const a = '<a href="/scripted">';</script><style>a{background:url(x)}</style>
    <a data-href="/data" title="a > b" href="/real">x</a><link rel="preconnect" href="https://fonts.example/"><link rel="stylesheet" href="/site.css">`;
  expect(extractHtmlLinks(html)).toEqual(['/real', '/site.css']);
});

test('reads fragment targets from id and name', () => {
  expect([...extractAnchors('<h2 id="install">Install</h2><a name=\'legacy\'></a><script>x = \'<p id="scripted">\'</script>')]).toEqual(['install', 'legacy']);
});

test('reads Markdown links and autolinks, but not code', () => {
  const text = ['[guard](https://kernl.run/docs/concepts/guard.md) and [titled](/about/ "About") and <https://kernl.run/app/>', '`[code](/inline)`', '```md', '[fenced](/fenced)', '```', '[angle](</docs/>)'].join('\n');
  expect(extractMarkdownLinks(text)).toEqual(['https://kernl.run/docs/concepts/guard.md', '/about/', '/docs/', 'https://kernl.run/app/']);
});

test('reads sitemap locations', () => {
  expect(extractSitemapLinks('<urlset><url><loc>https://kernl.run/about/</loc></url><url><loc> https://kernl.run/?a=1&amp;b=2 </loc></url></urlset>')).toEqual(['https://kernl.run/about/', 'https://kernl.run/?a=1&b=2']);
});

test('the regression: a clean docs URL with only a .html file behind it is broken until the build writes the copy', async () => {
  const dir = await site({
    'index.html': '<footer><a href="https://kernl.run/docs/decisions">Decisions</a><a href="/docs/concepts/applets">Format</a><a href="/docs/">Docs</a></footer>',
    'docs/index.html': '<a href="/docs/decisions">Decisions</a>',
    'docs/decisions.html': '<a href="./concepts/applets#posture">Applets</a>',
    'docs/concepts/applets.html': '<h2 id="posture">Posture</h2><a href="./../decisions">Decisions</a>',
  });
  const before = await checkSite({ dir, site: SITE });
  expect(before.ok).toBe(false);
  expect(before.broken.map((entry) => entry.url)).toEqual(['https://kernl.run/docs/concepts/applets', 'https://kernl.run/docs/concepts/applets#posture', 'https://kernl.run/docs/decisions']);
  expect(before.broken[2]).toMatchObject({ reason: 'the host serves no file for this path', files: ['docs/concepts/applets.html', 'docs/index.html', 'index.html'] });

  writeCleanUrlCopies(path.join(dir, 'docs'));
  const after = await checkSite({ dir, site: SITE });
  expect(after).toMatchObject({ ok: true, broken: [], pages: 4, internal: 4 });
});

test('resolves relative links from the page address and directory links to their index', async () => {
  expect(await broken({ 'index.html': '<a href="about/">a</a><a href="about">b</a><a href="./missing/">c</a>', 'about/index.html': '<a href="../">home</a><a href="why/">why</a>' })).toEqual([
    'https://kernl.run/about/why/ | the host serves no file for this path',
    'https://kernl.run/missing/ | the host serves no file for this path',
  ]);
});

test('checks fragments against the target page', async () => {
  const files = {
    'index.html': '<h1 id="top">kernl</h1><a href="#top">top</a><a href="#gone">gone</a><a href="/docs/#d-019">d</a><a href="/docs/#d-999">d</a><a href="/docs/#:~:text=quoted">t</a><a href="/docs/#caf%C3%A9">c</a><a href="/llms.txt#any">l</a>',
    'docs/index.html': '<h2 id="d-019">D-019</h2><h2 id="café">café</h2>',
    'llms.txt': '# kernl',
  };
  expect(await broken(files)).toEqual(['https://kernl.run/#gone | the page has no element with id "gone"', 'https://kernl.run/docs/#d-999 | the page has no element with id "d-999"']);
});

test('leaves other schemes and reserved names alone, and reports an address that cannot be parsed', async () => {
  const html = '<a href="mailto:a@kernl.run">m</a><a href="tel:+1">t</a><a href="javascript:void 0">j</a><a href="http://127.0.0.1:4178/">l</a><a href="https://shell.example/app">e</a><a href="http://[bad">x</a><a href="https://github.com/kehto/web">k</a>';
  const result = await checkSite({ dir: await site({ 'index.html': html }), site: SITE });
  expect(result.broken).toEqual([{ url: 'http://[bad', reason: 'not a valid address', files: ['index.html'] }]);
  expect(result).toMatchObject({ internal: 0, external: 1 });
});

test('reads links from Markdown twins, llms.txt and the sitemap', async () => {
  const files = {
    'index.html': '',
    'index.md': '[docs](https://kernl.run/docs/index.md)',
    'llms.txt': '- [About](https://kernl.run/about/index.md)',
    'sitemap-0.xml': '<urlset><url><loc>https://kernl.run/app/</loc></url></urlset>',
    'notes.json': '{"href":"/ignored"}',
  };
  expect(await broken(files)).toEqual([
    'https://kernl.run/about/index.md | the host serves no file for this path',
    'https://kernl.run/app/ | the host serves no file for this path',
    'https://kernl.run/docs/index.md | the host serves no file for this path',
  ]);
});

test('honours a site served under a path prefix', async () => {
  const dir = await site({ 'index.html': '<a href="/web/about/">a</a><a href="/web/missing/">m</a><a href="/elsewhere/">other site</a>', 'about/index.html': '' });
  const result = await checkSite({ dir, site: 'https://kernlize.github.io/web/' });
  expect(result.broken.map((entry) => entry.url)).toEqual(['https://kernlize.github.io/web/missing/']);
  expect(result.external).toBe(1);
});

test('outbound links: gone fails, an answer that proves nothing is reported, a hiccup is retried', async () => {
  const answers = { 'https://ok.dev/': [200], 'https://gone.dev/page': [404], 'https://removed.dev/': [410], 'https://walled.dev/': [403], 'https://flaky.dev/': [503, 200], 'https://down.dev/': [503, 503], 'https://nxdomain.dev/': ['ENOTFOUND', 'ENOTFOUND'], 'https://slow.dev/': ['TimeoutError', 'TimeoutError'] };
  const calls = [];
  const fetch = async (href) => {
    calls.push(href);
    const answer = answers[href].shift();
    if (typeof answer === 'number') return new Response(null, { status: answer === 200 ? 200 : answer });
    throw answer === 'ENOTFOUND' ? Object.assign(new TypeError('fetch failed'), { cause: { code: answer } }) : new DOMException('timed out', answer);
  };
  const html = Object.keys(answers).map((href) => `<a href="${href}#section">x</a>`).join('');
  const dir = await site({ 'index.html': html });
  const result = await checkSite({ dir, site: SITE, external: true, fetch });
  expect(result.broken.map((entry) => `${entry.url} ${entry.reason}`)).toEqual(['https://gone.dev/page HTTP 404', 'https://nxdomain.dev/ ENOTFOUND', 'https://removed.dev/ HTTP 410']);
  expect(result.unverified.map((entry) => `${entry.url} ${entry.reason}`)).toEqual(['https://down.dev/ HTTP 503', 'https://slow.dev/ TimeoutError', 'https://walled.dev/ HTTP 403']);
  expect(calls.filter((href) => href === 'https://flaky.dev/')).toHaveLength(2);
  expect(calls.filter((href) => href === 'https://gone.dev/page')).toHaveLength(1);

  const offline = await checkSite({ dir, site: SITE, fetch: () => Promise.reject(new Error('must not be called')) });
  expect(offline).toMatchObject({ ok: true, external: 8 });
});

test('live: asks the deployed host for every internal path, once each', async () => {
  const dir = await site({ 'index.html': '<a href="/about/#team">a</a><a href="/about/">b</a><a href="/about/?ref=home">c</a><a href="/docs/decisions">d</a>', 'about/index.html': '<h2 id="team">Team</h2>', 'docs/decisions/index.html': '' });
  const deployed = await host(dir);
  const asked = [];
  const fetch = (href, init) => {
    asked.push(href);
    return globalThis.fetch(href, init);
  };
  try {
    expect(await checkSite({ dir, site: SITE, live: deployed.origin, fetch })).toMatchObject({ ok: true, broken: [] });
    expect(asked.sort()).toEqual([`${deployed.origin}about/`, `${deployed.origin}about/?ref=home`, `${deployed.origin}docs/decisions`]);
  } finally {
    await deployed.close();
  }
});

test('live: a host that does not serve what the artifact holds is caught', async () => {
  const artifact = await site({ 'index.html': '<a href="/docs/decisions">d</a><a href="/about/">a</a>', 'about/index.html': '', 'docs/decisions/index.html': '' });
  const deployedCopy = await site({ 'index.html': '', 'about/index.html': '', 'docs/decisions.html': '' });
  const deployed = await host(deployedCopy);
  try {
    const result = await checkSite({ dir: artifact, site: SITE, live: deployed.origin });
    expect(result.ok).toBe(false);
    expect(result.broken).toEqual([{ url: `${deployed.origin}docs/decisions`, reason: 'the live site answered HTTP 404', files: ['index.html'] }]);
  } finally {
    await deployed.close();
  }
});

test('renders one block per finding and a summary', async () => {
  const result = { ok: false, pages: 3, internal: 9, external: 2, broken: [{ url: 'https://kernl.run/docs/decisions', reason: 'the host serves no file for this path', files: ['a.html', 'b.html', 'c.html', 'd.html', 'e.html'] }], unverified: [{ url: 'https://walled.dev/', reason: 'HTTP 403', files: ['a.html'] }] };
  expect(renderReport(result)).toBe(
    ['UNVERIFIED  https://walled.dev/', '    HTTP 403', '    linked from a.html', 'BROKEN  https://kernl.run/docs/decisions', '    the host serves no file for this path', '    linked from a.html, b.html, c.html (+2 more)', '3 files, 9 internal and 2 outbound destinations: 1 broken, 1 outbound unverified'].join('\n'),
  );
  expect(renderReport({ ...result, ok: true, broken: [], unverified: [] })).toBe('3 files, 9 internal and 2 outbound destinations: 0 broken');
});
