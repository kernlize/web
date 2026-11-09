export const SITE_NAME = 'kernl';
/** The source is private during alpha; public readers get the decisions record instead. */
export const DECISIONS_URL = 'https://kernl.run/docs/decisions';
export const TOOLKIT_URL = 'https://github.com/kehto/web';
export const APPLET_FORMAT_URL = 'https://napplet.run/';

export interface PageLink {
  readonly path: string;
  readonly label: string;
}

/** The long-form pages live under this prefix; the root is the short landing (D-021). */
export const ABOUT = 'about/';

export const NAV: readonly PageLink[] = [
  { path: ABOUT, label: 'Overview' },
  { path: `${ABOUT}why/`, label: 'Why' },
  { path: `${ABOUT}guard/`, label: 'Guard' },
  { path: `${ABOUT}messaging/`, label: 'Messaging' },
  { path: `${ABOUT}bridges/`, label: 'Bridges' },
  { path: `${ABOUT}developers/`, label: 'Developers' },
];

/** What the header offers outside the long-form pages: one way into them, one into the docs. */
export const HOME_NAV: readonly PageLink[] = [
  { path: ABOUT, label: 'About' },
  { path: 'docs/', label: 'Docs' },
];

/** The header links for a page, by where it sits. */
export const navFor = (pathname: string): readonly PageLink[] => (relativePath(pathname).startsWith(ABOUT) ? NAV : HOME_NAV);

const base = (): string => {
  const raw = import.meta.env.BASE_URL;
  return raw.endsWith('/') ? raw : `${raw}/`;
};

const site = (): string => {
  const raw = import.meta.env.SITE ?? 'https://kernl.run/';
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
