type Theme = 'light' | 'dark';

const current = (): Theme => {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

/** Flip the theme and remember the choice for this browser. */
export function toggleTheme(): void {
  const next: Theme = current() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('kernl-theme', next);
  } catch {
    // Private windows refuse storage; the theme still applies to this page.
  }
}

/** Wire the header toggle. The listener sits on the document because the header is replaced on every page transition. */
export function startThemeToggle(): void {
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('[data-theme-toggle]')) toggleTheme();
  });
}
