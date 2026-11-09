const DAY_MS = 86_400_000;

function startOfDay(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** A stable key for the local calendar day a moment falls on. */
export function dayKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function daysBefore(at: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
}

function calendarDate(at: number, now: number, weekday: boolean): string {
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    ...(weekday ? { weekday: 'short' as const } : {}),
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  }).format(at);
}

/** The label of a day separator in a thread. */
export function dayLabel(at: number, now: number): string {
  const days = daysBefore(at, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return calendarDate(at, now, true);
}

export function clockLabel(at: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(at);
}

/** The short time shown beside a thread in the list. */
export function listTimeLabel(at: number, now: number): string {
  if (at <= 0) return '';
  const days = daysBefore(at, now);
  if (days === 0) return clockLabel(at);
  if (days === 1) return 'Yesterday';
  return calendarDate(at, now, false);
}

/** One line of a message: whitespace collapsed, cut at `max` characters. */
export function snippet(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const characters = [...line];
  return characters.length <= max ? line : `${characters.slice(0, max - 1).join('').trimEnd()}…`;
}

/** Up to two letters standing in for a picture. */
export function initials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const [first = '', second = ''] = words;
  const letters = second ? [...first][0] + [...second][0] : [...first].slice(0, 2).join('');
  return letters.toUpperCase() || '?';
}

/** A hue that is always the same for the same seed (FNV-1a). */
export function tileHue(seed: string): number {
  let hash = 0x811c9dc5;
  for (const character of seed) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}
