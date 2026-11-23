import type { StorageLike } from '../types.js';

/** Whether one session plays at a time, the newest taking over, or many side by side. */
export type MediaConcurrency = 'one' | 'many';
/** What happens to the session a newer one takes over from: paused and kept, or ended. */
export type MediaTakeover = 'pause' | 'end';
/** Where a video the shell plays is shown: in a window of its own, or docked in the player. */
export type MediaVideoPlacement = 'window' | 'docked';
/** Whether a session keeps playing while its applet's window is hidden. */
export type MediaHiddenWindows = 'keep' | 'pause';
/** Whether a session may start without the person pressing play. */
export type MediaAutoplay = 'allow' | 'block';
/** What the shell does with what it plays for an applet when that applet closes: keep it playing, keep it paused, or end it. */
export type MediaAppletClosed = 'keep' | 'pause' | 'stop';

/** How the shell plays media for applets; the person chooses each in Settings (D-062). */
export interface MediaSettings {
  readonly concurrency: MediaConcurrency;
  readonly takeover: MediaTakeover;
  readonly video: MediaVideoPlacement;
  readonly hidden: MediaHiddenWindows;
  readonly autoplay: MediaAutoplay;
  readonly closed: MediaAppletClosed;
}

/**
 * Where the shell keeps the person's media settings.
 *
 * @example
 * ```ts
 * storage.getItem(MEDIA_SETTINGS_KEY); // '{"concurrency":"one",…}'
 * ```
 */
export const MEDIA_SETTINGS_KEY = 'kernl:media:v1';

/**
 * The choices each setting allows, the default first.
 *
 * @example
 * ```ts
 * MEDIA_SETTING_CHOICES.video; // ['window', 'docked']
 * ```
 */
export const MEDIA_SETTING_CHOICES: { readonly [K in keyof MediaSettings]: readonly MediaSettings[K][] } = {
  concurrency: ['one', 'many'],
  takeover: ['pause', 'end'],
  video: ['window', 'docked'],
  hidden: ['keep', 'pause'],
  autoplay: ['allow', 'block'],
  closed: ['keep', 'pause', 'stop'],
};

/**
 * One thing at a time, the older paused; video in a window; hidden windows keep playing; sessions may start on their own; what the shell plays outlives its applet.
 *
 * @example
 * ```ts
 * createKernlMedia({ storage }).settings(); // DEFAULT_MEDIA_SETTINGS on a first start
 * ```
 */
export const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  concurrency: 'one',
  takeover: 'pause',
  video: 'window',
  hidden: 'keep',
  autoplay: 'allow',
  closed: 'keep',
};

/**
 * Settings from anything: each field the shell knows keeps its value, and anything else takes the default.
 *
 * @param value - A parsed stored value, or a change the person made.
 * @returns Complete settings.
 * @example
 * ```ts
 * mediaSettingsFrom({ concurrency: 'many', video: 3 }); // { concurrency: 'many', video: 'window', … }
 * ```
 */
export function mediaSettingsFrom(value: unknown): MediaSettings {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const pick = <K extends keyof MediaSettings>(key: K): MediaSettings[K] => {
    const choices = MEDIA_SETTING_CHOICES[key] as readonly unknown[];
    return (choices.includes(record[key]) ? record[key] : DEFAULT_MEDIA_SETTINGS[key]) as MediaSettings[K];
  };
  return { concurrency: pick('concurrency'), takeover: pick('takeover'), video: pick('video'), hidden: pick('hidden'), autoplay: pick('autoplay'), closed: pick('closed') };
}

/**
 * The media settings the person last chose, or the defaults.
 *
 * @param storage - Where the shell keeps its settings.
 * @returns The settings.
 * @example
 * ```ts
 * readMediaSettings(localStorage).concurrency; // 'one'
 * ```
 */
export function readMediaSettings(storage: Pick<StorageLike, 'getItem'>): MediaSettings {
  const stored = storage.getItem(MEDIA_SETTINGS_KEY);
  try {
    return mediaSettingsFrom(stored === null ? {} : JSON.parse(stored));
  } catch {
    return DEFAULT_MEDIA_SETTINGS;
  }
}

/**
 * Keep the media settings for the next start.
 *
 * @param storage - Where the shell keeps its settings.
 * @param settings - What the person chose.
 * @returns The settings as kept.
 * @example
 * ```ts
 * writeMediaSettings(localStorage, { ...DEFAULT_MEDIA_SETTINGS, video: 'docked' });
 * ```
 */
export function writeMediaSettings(storage: Pick<StorageLike, 'setItem'>, settings: MediaSettings): MediaSettings {
  storage.setItem(MEDIA_SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}
