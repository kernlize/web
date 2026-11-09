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
