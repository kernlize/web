// Build-time agent output (D-007): a Markdown twin per page, /llms.txt (with /llm.txt as an identical alias for agents that ask for the singular) and /llms-full.txt, derived from the rendered HTML.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const SITE_URL = withSlash(process.env.SITE_URL ?? 'https://kernlize.github.io/');
const SITE_BASE = withSlash(process.env.SITE_BASE ?? '/');
const DECISIONS_URL = `${SITE_URL}docs/decisions`;
const TOOLKIT_URL = 'https://github.com/kehto/web';
const PAGE_ORDER = ['', 'why/', 'guard/', 'messaging/', 'bridges/', 'developers/', 'app/'];
const STRIP = 'script, style, noscript, template, svg, form, button, input, select, textarea, nav, header, footer, [aria-hidden="true"], [hidden], .skip-link, .section-head .label, .hero-copy .label';

function withSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

async function listIndexPages(dir, prefix = '') {
  const pages = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}${entry.name}` : entry.name;
    if (entry.isDirectory()) pages.push(...(await listIndexPages(dir, `${relative}/`)));
    else if (entry.name === 'index.html') pages.push(prefix);
  }
  return pages.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function rank(page) {
  const index = PAGE_ORDER.indexOf(page);
  return index === -1 ? PAGE_ORDER.length : index;
}

const collapse = (text) => text.replace(/\s+/g, ' ');

function inlineOf(node, base) {
  if (node.nodeType === 3) return collapse(node.textContent);
  if (node.nodeType !== 1) return '';
  const inner = () => Array.from(node.childNodes, (child) => inlineOf(child, base)).join('');
  switch (node.tagName.toLowerCase()) {
    case 'a': return linkOf(node, inner().trim(), base);
    case 'strong': case 'b': return `**${inner().trim()}**`;
    case 'em': case 'i': return `*${inner().trim()}*`;
    case 'code': return `\`${node.textContent.trim()}\``;
    case 'br': return '\n';
    default: return inner();
  }
}

function absolute(target, base) {
  if (target.startsWith(SITE_BASE)) return `${SITE_URL}${target.slice(SITE_BASE.length)}`;
  return new URL(target, base).href;
}

function linkOf(anchor, text, base) {
  try {
    return `[${text}](${absolute(anchor.getAttribute('href') ?? '', base)})`;
  } catch {
    return text;
  }
}

function blocksOf(element, base) {
  return Array.from(element.children, (child) => blockOf(child, base)).filter(Boolean);
}

function blockOf(element, base) {
  const tag = element.tagName.toLowerCase();
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) return `${'#'.repeat(Number(heading[1]))} ${inlineOf(element, base).trim()}`;
  switch (tag) {
    case 'p': return element.classList.contains('label') ? `*${inlineOf(element, base).trim()}*` : inlineOf(element, base).trim();
    case 'figcaption': return inlineOf(element, base).trim();
    case 'ul': case 'ol': return listOf(element, base, tag === 'ol');
    case 'dl': return definitionsOf(element, base);
    case 'blockquote': return blocksOf(element, base).join('\n\n').replace(/^/gm, '> ');
    case 'pre': return `\`\`\`\n${element.textContent.replace(/\n$/, '')}\n\`\`\``;
    case 'hr': return '---';
    default: return element.children.length ? blocksOf(element, base).join('\n\n') : inlineOf(element, base).trim();
  }
}

function listOf(list, base, ordered) {
  return Array.from(list.children)
    .filter((item) => item.tagName.toLowerCase() === 'li')
    .map((item, index) => {
      const marker = ordered ? `${index + 1}.` : '-';
      const body = itemOf(item, base).replace(/\n/g, `\n${' '.repeat(marker.length + 1)}`);
      return `${marker} ${body}`;
    })
    .join('\n');
}

function itemOf(item, base) {
  if (!item.children.length || Array.from(item.children).every((child) => !/^(h[1-6]|p|ul|ol|div)$/i.test(child.tagName))) {
    return inlineOf(item, base).trim();
  }
  return Array.from(item.children, (child) => {
    if (/^h[1-6]$/i.test(child.tagName)) return `**${inlineOf(child, base).trim()}**`;
    return blockOf(child, base);
  }).filter(Boolean).join('\n');
}

function definitionsOf(list, base) {
  const rows = [];
  for (const term of list.querySelectorAll('dt')) {
    const detail = term.nextElementSibling;
    const value = detail?.tagName.toLowerCase() === 'dd' ? inlineOf(detail, base).trim() : '';
    rows.push(`- **${inlineOf(term, base).trim()}**: ${value}`);
  }
  return rows.join('\n');
}

function decodeTitle(document) {
  const [first] = (document.querySelector('title')?.textContent ?? '').split(' · ');
  return first?.trim() || 'kernl';
}

function pageMarkdown(html, page) {
  const { document } = parseHTML(html);
  const main = document.querySelector('main') ?? document.body;
  for (const node of main.querySelectorAll(STRIP)) node.remove();
  const base = `${SITE_URL}${page}`;
  const title = decodeTitle(document);
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
  const body = blocksOf(main, base).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  const [first, ...rest] = body.split('\n\n');
  const lead = first?.startsWith('# ') ? first : `# ${title}`;
  const remainder = first?.startsWith('# ') ? rest : [first, ...rest];
  return { title, description, markdown: `${[lead, `> ${description}`, ...remainder].filter(Boolean).join('\n\n')}\n` };
}

async function writeTwins() {
  const pages = [];
  for (const page of await listIndexPages(DIST)) {
    const html = await readFile(path.join(DIST, page, 'index.html'), 'utf8');
    const twin = pageMarkdown(html, page);
    await writeFile(path.join(DIST, page, 'index.md'), twin.markdown);
    pages.push({ page, url: `${SITE_URL}${page}`, markdownUrl: `${SITE_URL}${page}index.md`, ...twin });
  }
  return pages;
}

function renderLlmsTxt(pages) {
  const home = pages.find((entry) => entry.page === '') ?? pages[0];
  const lines = [
    '# kernl',
    '',
    `> ${home.description}`,
    '',
    'kernl is alpha software, MIT licensed, built on the open kehto toolkit and the open applet format it hosts. Every page below has a Markdown twin at `index.md` next to it; the links point at the twins.',
    '',
    '## Pages',
    '',
    ...pages.map((entry) => `- [${entry.title}](${entry.markdownUrl}): ${entry.description}`),
    '',
    '## Docs',
    '',
    `- [Documentation index](${SITE_URL}docs/llms.txt): concepts, how-tos and reference for every package, written for developers.`,
    `- [Full documentation text](${SITE_URL}docs/llms-full.txt): every docs page in one file.`,
    '',
    '## Source',
    '',
    `- [Decisions](${DECISIONS_URL}): every architecture decision and its reason. TypeScript, MIT; the source is private during alpha.`,
    `- [kehto toolkit](${TOOLKIT_URL}): the unopinionated toolkit kernl composes.`,
    `- [Full site text](${SITE_URL}llms-full.txt): every page of this site in one file.`,
    '',
  ];
  return lines.join('\n');
}

function renderLlmsFull(pages) {
  const body = pages.map((entry) => `<!-- ${entry.markdownUrl} -->\n\n${entry.markdown}`).join('\n---\n\n');
  return `# kernl\n\n> Full text of every page on this site, in reading order.\n\n${body}`;
}

async function main() {
  await mkdir(DIST, { recursive: true });
  const pages = await writeTwins();
  const llms = renderLlmsTxt(pages);
  await writeFile(path.join(DIST, 'llms.txt'), llms);
  await writeFile(path.join(DIST, 'llm.txt'), llms);
  await writeFile(path.join(DIST, 'llms-full.txt'), renderLlmsFull(pages));
  process.stdout.write(`agent output: ${pages.length} Markdown twins, llms.txt, llm.txt, llms-full.txt\n`);
}

await main();
