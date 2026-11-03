import type { HeadConfig, PageData } from 'vitepress';
import { DOCS_URL } from './agent-output';


function pageUrl(relativePath: string): string {
  const path = relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
  return new URL(path, DOCS_URL).href;
}

const SOFTWARE = {
  '@type': 'SoftwareSourceCode',
  name: 'kernl',
  programmingLanguage: 'TypeScript',
  license: 'https://opensource.org/license/mit',
  offers: { '@type': 'Offer', price: '0.00', priceCurrency: 'USD' },
};

/**
 * JSON-LD for a docs page: a `TechArticle` for the page, plus the project's `SoftwareSourceCode` record on the docs root.
 * @param pageData The page being rendered.
 * @returns Head entries, empty for the 404 page.
 */
export function structuredData(pageData: PageData): HeadConfig[] {
  if (pageData.isNotFound || pageData.relativePath === '404.md') return [];
  const url = pageUrl(pageData.relativePath);
  const article = {
    '@type': 'TechArticle',
    headline: pageData.title,
    description: pageData.description || pageData.frontmatter.description,
    url,
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', name: 'kernl documentation', url: DOCS_URL },
    about: { '@type': 'SoftwareSourceCode', name: 'kernl', license: 'https://opensource.org/license/mit' },
  };
  const graph = pageData.relativePath === 'index.md' ? [article, SOFTWARE] : [article];
  return [['script', { type: 'application/ld+json' }, JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })]];
}
