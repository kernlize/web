import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HeadConfig, PageData, SiteConfig } from 'vitepress';

interface SidebarItem {
  text: string;
  link?: string;
  items?: SidebarItem[];
}
interface SidebarGroup {
  text: string;
  items: SidebarItem[];
}
interface DocsPage {
  relativePath: string;
  title: string;
  markdown: string;
}
interface LlmsLink {
  title: string;
  url: string;
  description?: string;
}
interface LlmsSection {
  name: string;
  links: LlmsLink[];
}

const pages = new Map<string, PageData>();

/** Absolute URL of the docs root. D-008: `SITE_URL` is the deployment root and the docs are always served under `docs/` beneath it. */
export const DOCS_URL = new URL('docs/', process.env.SITE_URL ?? 'https://kernl.run/').href;

/**
 * Remember page data so `buildEnd` can reuse parsed frontmatter and titles.
 * @param pageData Page data VitePress hands to `transformPageData`.
 */
export function collectPage(pageData: PageData): void {
  pages.set(pageData.relativePath, pageData);
}

/**
 * `<link rel="alternate" type="text/markdown">` for a page, pointing at its Markdown twin.
 * @param pageData The page being rendered.
 * @param base The VitePress base path, with leading and trailing slash.
 * @returns Head entries for the page, empty for the 404 page.
 */
export function markdownAlternate(pageData: PageData, base: string): HeadConfig[] {
  if (pageData.isNotFound || pageData.relativePath === '404.md') return [];
  return [['link', { rel: 'alternate', type: 'text/markdown', href: `${base}${pageData.relativePath}` }]];
}

function summaryOf(markdown: string): string | undefined {
  const blocks = markdown.split(/\n{2,}/).map((block) => block.trim());
  const lead = blocks.find((block) => /^[A-Za-z*`[]/.test(block) || (block.startsWith('> ') && !block.startsWith('> **')));
  if (!lead) return undefined;
  const text = lead
    .replace(/^> ?/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
}

function sourcePathFor(link: string): string {
  const clean = link.replace(/^\//, '').replace(/\.html$/, '');
  return clean === '' || clean.endsWith('/') ? `${clean}index.md` : `${clean}.md`;
}

const linksOf = (items: SidebarItem[]): string[] =>
  items.flatMap((item) => [...(item.link ? [item.link] : []), ...linksOf(item.items ?? [])]);

function rewriteTarget(target: string, relativePath: string, docsUrl: string): string {
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return target;
  const [rawPath, hash = ''] = target.split('#');
  if (!rawPath) return target;
  const dir = rawPath.startsWith('/') ? '' : relativePath.slice(0, relativePath.lastIndexOf('/') + 1);
  const url = new URL(rawPath.replace(/^\//, ''), `${docsUrl}${dir}`);
  const ext = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const generated = url.pathname.startsWith(new URL('api/', docsUrl).pathname);
  if (ext === 'md' || (ext === 'html' && !generated)) url.pathname = url.pathname.replace(/\.[a-z]+$/i, '.md');
  else if (!ext) url.pathname = url.pathname.endsWith('/') ? `${url.pathname}index.md` : `${url.pathname}.md`;
  return `${url.href}${hash ? `#${hash}` : ''}`;
}

function rewriteLinks(markdown: string, relativePath: string, docsUrl: string): string {
  return markdown
    .replace(/(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))(\{[^}]*\})?/g, (_, open, target, close) => `${open}${rewriteTarget(target, relativePath, docsUrl)}${close}`);
}

function convertContainers(markdown: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let inContainer = false;
  for (const line of markdown.split('\n')) {
    const fenceMatch = line.match(/^(`{3,}|~{3,})/);
    if (fenceMatch && !fence) fence = fenceMatch[1];
    else if (fence && line.startsWith(fence)) fence = null;
    else if (!fence) {
      const open = line.match(/^:::\s*([a-z]+)(?:\s+(.*))?$/i);
      if (open && !inContainer) {
        inContainer = true;
        out.push(`> **${open[2]?.trim() || open[1].toUpperCase()}**`, '>');
        continue;
      }
      if (inContainer && /^:::\s*$/.test(line)) {
        inContainer = false;
        continue;
      }
    }
    out.push(inContainer ? (line ? `> ${line}` : '>') : line);
  }
  return out.join('\n');
}

function homeMarkdown(frontmatter: Record<string, any>): string {
  const hero = frontmatter.hero ?? {};
  const parts = [`# ${[hero.name, hero.text].filter(Boolean).join(': ')}`];
  if (hero.tagline) parts.push(hero.tagline);
  const actions = (hero.actions ?? []).map((action: { text: string; link: string }) => `- [${action.text}](${action.link})`);
  if (actions.length) parts.push(actions.join('\n'));
  for (const feature of frontmatter.features ?? []) parts.push(`## ${feature.title}\n\n${feature.details}`);
  return parts.join('\n\n');
}

/**
 * Turn a VitePress source page into standalone Markdown: frontmatter removed, containers as blockquotes, internal links absolute.
 * @param page Source path relative to the docs root, its Markdown and parsed frontmatter.
 * @param docsUrl Absolute URL of the docs root, with trailing slash.
 * @returns Markdown ending in a newline.
 */
export function docsPageMarkdown(page: { relativePath: string; source: string; frontmatter?: Record<string, any> }, docsUrl: string): string {
  const frontmatter = page.frontmatter ?? {};
  let body = page.source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  if (frontmatter.layout === 'home') body = `${homeMarkdown(frontmatter)}\n\n${body}`;
  body = rewriteLinks(convertContainers(body), page.relativePath, docsUrl);
  return `${body.replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/**
 * Render an llms.txt document (https://llmstxt.org/): H1, blockquote summary, notes, then H2 link sections.
 * @param input Title, one-sentence summary, optional notes and the link sections.
 * @returns llms.txt Markdown.
 */
export function renderLlmsTxt(input: { title: string; summary: string; notes?: string; sections: LlmsSection[] }): string {
  const parts = [`# ${input.title}`, `> ${input.summary}`];
  if (input.notes) parts.push(input.notes.trim());
  for (const section of input.sections) {
    if (!section.links.length) continue;
    const links = section.links.map((link) => `- [${link.title}](${link.url})${link.description ? `: ${link.description}` : ''}`);
    parts.push(`## ${section.name}\n\n${links.join('\n')}`);
  }
  return `${parts.join('\n\n')}\n`;
}

function sectionsFor(docs: DocsPage[], sidebar: SidebarGroup[], docsUrl: string): LlmsSection[] {
  const byPath = new Map(docs.map((page) => [page.relativePath, page]));
  const used = new Set<string>();
  const link = (page: DocsPage): LlmsLink => ({ title: page.title, url: `${docsUrl}${page.relativePath}`, description: summaryOf(page.markdown) });
  const sections: LlmsSection[] = [];
  for (const group of sidebar) {
    const links: LlmsLink[] = [];
    for (const target of linksOf(group.items)) {
      const page = byPath.get(sourcePathFor(target));
      if (page && !used.has(page.relativePath)) {
        used.add(page.relativePath);
        links.push(link(page));
      }
    }
    sections.push({ name: group.text, links });
  }
  const rest = docs.filter((page) => !used.has(page.relativePath)).map(link);
  if (rest.length) sections.push({ name: 'Other pages', links: rest });
  return sections;
}

/**
 * Inline VitePress `<!--@include: path{start,end}-->` directives so a Markdown twin carries the included text, not the directive.
 * @param source Page source.
 * @param dir Directory the page lives in; include paths resolve against it.
 * @returns The source with every include replaced by the lines it selects.
 */
export async function expandIncludes(source: string, dir: string): Promise<string> {
  const pattern = /<!--\s*@include:\s*([^{\s]+?)(?:\{(\d*),(\d*)\})?\s*-->/g;
  let out = source;
  for (const [directive, file, start, end] of source.matchAll(pattern)) {
    const lines = (await readFile(path.resolve(dir, file), 'utf8')).split('\n');
    const from = start ? Number(start) - 1 : 0;
    const to = end ? Number(end) : lines.length;
    out = out.replace(directive, lines.slice(from, to).join('\n'));
  }
  return out;
}

/**
 * Write a `.md` twin next to every built page, then `llms.txt` and `llms-full.txt` at the docs root.
 * @param siteConfig Resolved VitePress site config from `buildEnd`.
 * @param sidebar Sidebar groups, used to order the llms.txt sections.
 */
export async function writeAgentOutput(siteConfig: SiteConfig, sidebar: SidebarGroup[]): Promise<void> {
  const docsUrl = DOCS_URL;
  const docs: DocsPage[] = [];
  for (const relativePath of [...siteConfig.pages].sort()) {
    if (relativePath === '404.md') continue;
    const sourcePath = path.join(siteConfig.srcDir, relativePath);
    const source = await expandIncludes(await readFile(sourcePath, 'utf8'), path.dirname(sourcePath));
    const data = pages.get(relativePath);
    const markdown = docsPageMarkdown({ relativePath, source, frontmatter: data?.frontmatter ?? {} }, docsUrl);
    const target = path.join(siteConfig.outDir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, markdown);
    const heading = markdown.match(/^# (.+)$/m)?.[1];
    docs.push({ relativePath, title: data?.title || heading || relativePath, markdown });
  }
  const summary = siteConfig.site.description;
  const notes = `Markdown twins of every docs page, served at the HTML path with \`.md\` instead of \`.html\`. These docs describe one shell; the protocol authority is NIP-5D (https://github.com/nostr-protocol/nips/pull/2303) and the NAPs (https://github.com/napplet/naps).`;
  await writeFile(path.join(siteConfig.outDir, 'llms.txt'), renderLlmsTxt({ title: 'kernl docs', summary, notes, sections: sectionsFor(docs, sidebar, docsUrl) }));
  const full = docs.map((page) => `<!-- ${docsUrl}${page.relativePath} -->\n\n${page.markdown}`).join('\n---\n\n');
  await writeFile(path.join(siteConfig.outDir, 'llms-full.txt'), `# kernl docs\n\n> ${summary}\n\n${full}`);
}
