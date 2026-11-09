const OUTSIDE = ['app', 'docs'];

/**
 * Whether a path is one of the site's own pages. Only those carry the stage, so only they get the curtain;
 * the shell, the docs and plain files load on their own (D-023).
 */
export function isSitePage(pathname: string, base = '/'): boolean {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  if (!`${pathname}/`.startsWith(prefix)) return false;
  const segments = pathname.slice(prefix.length).split('/').filter(Boolean);
  const [first] = segments;
  if (first !== undefined && OUTSIDE.includes(first)) return false;
  return !(segments.at(-1) ?? '').includes('.');
}

/** Whether moving between two URLs changes the page, rather than scrolling within it. */
export function changesPage(from: URL, to: URL): boolean {
  return from.origin === to.origin && (from.pathname !== to.pathname || from.search !== to.search);
}
