import { STORAGE_DOMAIN } from '@napplet/sdk';
import { runtimeHasDomain } from './domain-availability.js';
import { parseSaved, serializeSaved, type SavedState } from './saved-state.js';
import { readStored, writeStored } from './shell.js';
import type { SeenState } from './threads.js';

export interface Persistence {
  load(owner: string): Promise<SavedState>;
  /** Write the current drafts and last-seen times soon; calls close together become one write. */
  save(owner: string, drafts: ReadonlyMap<string, string>, seen: SeenState): void;
  /** Write whatever is still waiting; called when the frame goes away. */
  flush(): void;
}

const WRITE_DELAY_MS = 1000;

/**
 * Drafts and last-seen times live in the shell's scoped storage when the shell
 * offers it, as one value per account: one read at startup, one write per
 * pause in typing. Without storage they only last as long as this frame, which
 * the caller's in-memory state already covers, so every method is a no-op.
 * The key carries the account because one frame can outlive an account switch.
 */
export function createPersistence(): Persistence {
  let waiting: { timer: number; key: string; value: () => string } | null = null;
  const available = (): boolean => runtimeHasDomain(STORAGE_DOMAIN);

  function write(urgent: boolean): void {
    if (!waiting) return;
    const { timer, key, value } = waiting;
    waiting = null;
    window.clearTimeout(timer);
    writeStored(key, value(), urgent ? 'normal' : 'background');
  }

  return {
    async load(owner) {
      if (!available()) return parseSaved(null);
      try {
        return parseSaved(await readStored(`state:${owner}`));
      } catch {
        return parseSaved(null);
      }
    },
    save(owner, drafts, seen) {
      if (!available()) return;
      const key = `state:${owner}`;
      if (waiting && waiting.key !== key) write(true);
      window.clearTimeout(waiting?.timer);
      const timer = window.setTimeout(() => write(false), WRITE_DELAY_MS);
      waiting = { timer, key, value: () => serializeSaved(drafts, seen) };
    },
    flush() {
      write(true);
    },
  };
}
