import { RECENT_KEY, type StorageLike } from './contract';

export interface RecentApplet {
  readonly address: string;
  readonly title: string;
  readonly publisher: string;
  readonly openedAt: number;
}

const LIMIT = 8;

export function readRecent(storage: StorageLike): RecentApplet[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecent) : [];
  } catch {
    return [];
  }
}

function isRecent(value: unknown): value is RecentApplet {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.address === 'string' && typeof row.title === 'string' && typeof row.publisher === 'string' && typeof row.openedAt === 'number';
}

/** Move or add an applet to the front of the recent list and persist it. */
export function rememberRecent(storage: StorageLike, entry: Omit<RecentApplet, 'openedAt'>, now = Date.now()): RecentApplet[] {
  const rest = readRecent(storage).filter((row) => row.address !== entry.address);
  const next = [{ ...entry, openedAt: now }, ...rest].slice(0, LIMIT);
  storage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

export function forgetRecent(storage: StorageLike, address: string): RecentApplet[] {
  const next = readRecent(storage).filter((row) => row.address !== address);
  storage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}
