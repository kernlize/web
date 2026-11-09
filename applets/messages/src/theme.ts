import { THEME_DOMAIN, type Subscription, type Theme } from '@napplet/sdk';
import { runtimeHasDomain } from './domain-availability.js';
import { onThemeChanged, readTheme } from './shell.js';

function isDark(color: string): boolean | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!hex) return null;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  const [red, green, blue] = [0, 2, 4].map((start) => Number.parseInt(full.slice(start, start + 2), 16));
  return (red * 299 + green * 587 + blue * 114) / 1000 < 128;
}

/**
 * The shell's colours repaint the whole surface: html, body and the root all
 * read --bg/--fg, and every other token in the stylesheet derives from the
 * three set here. `color-scheme` follows the background so native scrollbars
 * and form controls match it too.
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement.style;
  root.setProperty('--bg', theme.colors.background);
  root.setProperty('--fg', theme.colors.text);
  root.setProperty('--primary', theme.colors.primary);
  const dark = isDark(theme.colors.background);
  if (dark !== null) root.setProperty('color-scheme', dark ? 'dark' : 'light');
}

/**
 * Follow the shell's theme; without one the stylesheet's own palette stays.
 * Listening costs nothing, so a pushed change applies at once; asking for the
 * current theme is a request and waits its turn behind the startup reads.
 */
export function followTheme(): Subscription | null {
  if (!runtimeHasDomain(THEME_DOMAIN)) return null;
  try {
    readTheme().then(applyTheme).catch(() => undefined);
    return onThemeChanged(applyTheme);
  } catch {
    return null;
  }
}
