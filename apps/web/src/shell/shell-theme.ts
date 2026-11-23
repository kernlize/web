/** The colours an applet is told, in the shape the theme domain carries. A type alias, so it passes where a plain record is asked for. */
export type ShellTheme = {
  readonly colors: { readonly background: string; readonly text: string; readonly primary: string };
};

const TOKENS = ['--bg-raised', '--ink', '--accent'] as const;

/**
 * The shell's own colours for applets that ask for the theme, read from the page's style tokens:
 * the surface an applet's window sits on, the text colour and the accent. A page without the
 * tokens gets no theme, and applets keep the toolkit's default.
 */
export function shellTheme(read: (token: string) => string): ShellTheme | undefined {
  const [background, text, primary] = TOKENS.map((token) => read(token).trim());
  return background && text && primary ? { colors: { background, text, primary } } : undefined;
}

/**
 * Something that tells the shell the page's palette may have changed — the `data-theme` attribute
 * being set, the system's colour-scheme preference flipping — and how to stop listening to it.
 */
export type ThemeSignal = (onChange: () => void) => () => void;

/**
 * Tell the applets the page's colours whenever they change (D-064).
 *
 * The tokens are read again on every signal and published only when they say something different,
 * so an attribute set to the value it already had tells nobody. A page whose tokens are missing
 * publishes nothing and keeps watching, so a later theme still reaches the applets. The page is
 * read once as the following starts, so a change made while the shell was still starting is told too.
 *
 * @param signals - Where the page's palette can change.
 * @param read - Reads one of the page's style tokens.
 * @param publish - Hands a changed palette to the shell's applets.
 * @param opened - The palette applets are answered with when they open: the one the shell was started with.
 * @returns A function that stops listening.
 * @example
 * ```ts
 * const stop = followShellTheme([onAttribute], (token) => style.getPropertyValue(token), (theme) => kernl.theme.publish(theme), opened);
 * ```
 */
export function followShellTheme(signals: readonly ThemeSignal[], read: (token: string) => string, publish: (theme: ShellTheme) => void, opened: ShellTheme | undefined): () => void {
  let told = keyOf(opened);
  const follow = (): void => {
    const theme = shellTheme(read);
    const next = keyOf(theme);
    if (next === told) return;
    told = next;
    if (theme) publish(theme);
  };
  const stop = signals.map((signal) => signal(follow));
  follow();
  return () => {
    for (const unsubscribe of stop) unsubscribe();
  };
}

/** A palette as one string, so a change is a change in what the applets would hear. */
const keyOf = (theme: ShellTheme | undefined): string => (theme ? `${theme.colors.background} ${theme.colors.text} ${theme.colors.primary}` : '');
