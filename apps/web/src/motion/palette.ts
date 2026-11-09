export type Rgb = readonly [number, number, number];

export interface Palette {
  readonly ink: Rgb;
  readonly bright: Rgb;
  readonly accent: Rgb;
  readonly panel: Rgb;
}

const GREY: Rgb = [0.5, 0.5, 0.5];

/** Parse `#rgb` or `#rrggbb` into unit-range channels. Anything else is mid grey, so a token the stage cannot read never stops a frame. */
export function parseHex(value: string): Rgb {
  const hex = value.trim().replace(/^#/, '');
  const full = hex.length === 3 ? Array.from(hex, (digit) => digit + digit).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return GREY;
  const channel = (at: number): number => Number.parseInt(full.slice(at, at + 2), 16) / 255;
  return [channel(0), channel(2), channel(4)];
}

/** The stage draws in the page's own colours: read them from the theme tokens in `global.css`. */
export function readPalette(read: (token: string) => string): Palette {
  return {
    ink: parseHex(read('--ink-muted')),
    bright: parseHex(read('--ink')),
    accent: parseHex(read('--accent')),
    panel: parseHex(read('--bg-sunken')),
  };
}
