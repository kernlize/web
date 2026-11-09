import type { SeenState } from './threads.js';

const DRAFT_LIMIT = 8_000;

/** Everything kept between sessions, stored as one value so it costs one read. */
export interface SavedState {
  drafts: Map<string, string>;
  /** Null when nothing usable was stored: the first run for this account. */
  seen: SeenState | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readSeen(value: unknown): SeenState | null {
  const record = asRecord(value);
  if (!record || typeof record.baseline !== 'number' || !Number.isFinite(record.baseline)) return null;
  const threads: Record<string, number> = {};
  for (const [key, at] of Object.entries(asRecord(record.threads) ?? {})) {
    if (typeof at === 'number' && Number.isFinite(at)) threads[key] = at;
  }
  return { baseline: record.baseline, threads };
}

function readDrafts(value: unknown): Map<string, string> {
  const drafts = new Map<string, string>();
  for (const [key, text] of Object.entries(asRecord(value) ?? {})) {
    if (typeof text === 'string' && text) drafts.set(key, text);
  }
  return drafts;
}

/** Read the stored value; anything unreadable counts as a first run. */
export function parseSaved(raw: string | null): SavedState {
  let stored: Record<string, unknown> | null = null;
  try {
    stored = raw ? asRecord(JSON.parse(raw)) : null;
  } catch {
    stored = null;
  }
  return { drafts: readDrafts(stored?.drafts), seen: readSeen(stored?.seen) };
}

export function serializeSaved(drafts: ReadonlyMap<string, string>, seen: SeenState): string {
  const kept: Record<string, string> = {};
  for (const [key, text] of drafts) kept[key] = text.slice(0, DRAFT_LIMIT);
  return JSON.stringify({ seen, drafts: kept });
}
