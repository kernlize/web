import type { MediaSessionView, MediaSettings } from '@kernlize/core';

/** One setting in the Media section: a heading and its choices, the default first. */
export interface MediaSettingGroup<K extends keyof MediaSettings = keyof MediaSettings> {
  readonly key: K;
  readonly label: string;
  readonly choices: readonly { readonly id: MediaSettings[K]; readonly label: string }[];
}

/** The Media section of Settings, in the order it lists them (D-061). */
export const MEDIA_SETTING_GROUPS: readonly MediaSettingGroup[] = [
  { key: 'concurrency', label: 'Playing at once', choices: [{ id: 'one', label: 'One at a time' }, { id: 'many', label: 'Several at once' }] },
  { key: 'takeover', label: 'When another starts', choices: [{ id: 'pause', label: 'Pause the earlier one' }, { id: 'end', label: 'End the earlier one' }] },
  { key: 'video', label: 'Videos', choices: [{ id: 'window', label: 'In their own window' }, { id: 'docked', label: 'In the player' }] },
  { key: 'hidden', label: 'Hidden windows', choices: [{ id: 'keep', label: 'Keep playing' }, { id: 'pause', label: 'Pause until shown' }] },
  { key: 'autoplay', label: 'Starting on its own', choices: [{ id: 'allow', label: 'Allowed' }, { id: 'block', label: 'Wait for play' }] },
];

/**
 * The groups the section shows now: what happens to an earlier session only matters when one plays at a time.
 *
 * @param settings - The settings in force.
 * @returns The groups to draw.
 */
export function mediaSettingGroups(settings: MediaSettings): readonly MediaSettingGroup[] {
  return MEDIA_SETTING_GROUPS.filter((group) => group.key !== 'takeover' || settings.concurrency === 'one');
}

/** Seconds as the player shows them: `m:ss`, or `h:mm:ss` from an hour. */
export function mediaTime(seconds: number | undefined): string {
  const whole = Math.max(0, Math.floor(seconds ?? 0));
  const s = String(whole % 60).padStart(2, '0');
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** What a session is called: its title, or what it is. */
export function mediaTitle(session: Pick<MediaSessionView, 'metadata' | 'video'>): string {
  return session.metadata?.title?.trim() || (session.video ? 'Video' : 'Audio');
}

/** The short line under a session's title: who plays it, by what name, and how far along. */
export function mediaLine(session: Pick<MediaSessionView, 'metadata' | 'state'>, applet: string): string {
  const status = session.state?.status ?? 'paused';
  const words: Readonly<Record<string, string>> = { playing: 'Playing', paused: 'Paused', stopped: 'Stopped', buffering: 'Loading' };
  const artist = session.metadata?.artist?.trim();
  return [artist, applet, words[status] ?? 'Paused'].filter(Boolean).join(' · ');
}

/** True when the player's main button should pause rather than play. */
export const isPlaying = (session: Pick<MediaSessionView, 'state'>): boolean => session.state?.status === 'playing' || session.state?.status === 'buffering';

/** The window id a docked or windowed video is shown in. */
export const VIDEO_PANEL_PREFIX = 'media:';

/** The panel name a session's video window has. */
export const videoPanel = (sessionId: string): string => `${VIDEO_PANEL_PREFIX}${sessionId}`;

/** The session a panel shows, or nothing when it is not a video window. */
export function sessionOfPanel(panel: string): string | undefined {
  return panel.startsWith(VIDEO_PANEL_PREFIX) ? panel.slice(VIDEO_PANEL_PREFIX.length) : undefined;
}
