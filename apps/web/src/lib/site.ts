export const SITE_NAME = 'kernl';
export const REPO_URL = 'https://github.com/kernlize/web';
export const TOOLKIT_URL = 'https://github.com/kehto/web';
export const APPLET_FORMAT_URL = 'https://napplet.run/';

export interface PageLink {
  readonly path: string;
  readonly label: string;
}

export const NAV: readonly PageLink[] = [
  { path: 'why/', label: 'Why' },
  { path: 'guard/', label: 'Guard' },
  { path: 'messaging/', label: 'Messaging' },
  { path: 'bridges/', label: 'Bridges' },
  { path: 'developers/', label: 'Developers' },
];

const base = (): string => {
  const raw = import.meta.env.BASE_URL;
  return raw.endsWith('/') ? raw : `${raw}/`;
};

const site = (): string => {
  const raw = import.meta.env.SITE ?? 'https://kernlize.github.io/';
  return raw.endsWith('/') ? raw : `${raw}/`;
};

/** Path under the configured base, for links within the site. */
export const href = (path: string): string => `${base()}${path.replace(/^\/+/, '')}`;

/** Path relative to the base, without a leading slash: `/web/why/` becomes `why/`. */
export const relativePath = (pathname: string): string => {
  const prefix = base();
  const inner = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  return inner.replace(/^\/+/, '');
};

/** Absolute URL under SITE_URL for a page or asset pathname (D-008). */
export const absoluteUrl = (pathname: string): string => new URL(relativePath(pathname), site()).href;

export const markdownTwin = (pathname: string): string => href(`${relativePath(pathname)}index.md`);
