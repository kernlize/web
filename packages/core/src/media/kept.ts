import type { MediaAction, MediaPlayback, MediaPlaybackState, MediaSessionSnapshot } from '@kehto/services';
import { ACTIVE } from './steering.js';

/** A session the shell plays on after its applet closed: detached from the applet, and the person's to stop. */
export interface KeptSession {
  /** `<window>/<session>`: never an id an applet can name, so a new instance cannot reach it. */
  readonly id: string;
  /** The id kehto knew it by while its applet was open. */
  readonly from: string;
  readonly playback: MediaPlayback;
  snapshot: MediaSessionSnapshot;
}

/** The sessions kept after their applets closed. */
export interface KeptSessions {
  /** Keep `playback` when kehto lets its session go; it is detached from now on. */
  adopt(playback: MediaPlayback, snapshot: MediaSessionSnapshot): KeptSession;
  /** What kehto is handed in place of `playback`: the same output, which it cannot destroy once kept. */
  wrap(playback: MediaPlayback): MediaPlayback;
  /** Take a state report for a kept playback; false when it is not kept. */
  report(playback: MediaPlayback, state: MediaPlaybackState, actions: readonly MediaAction[]): boolean;
  get(id: string): KeptSession | undefined;
  all(): readonly KeptSession[];
  /** Stop a kept session and let its output go. */
  end(session: KeptSession): void;
  /** `winner` took the output under one at a time: each kept session playing is paused, or ended. */
  yieldTo(winner: string, takeover: 'pause' | 'end'): void;
}

/** What the media service hears from its kept sessions. */
export interface KeptHooks {
  /** A kept session started playing. */
  started(id: string): void;
  /** Something about the kept sessions changed. */
  changed(): void;
}

/**
 * NAP-MEDIA lets the shell keep playing what it plays for an applet after the applet closes, if it
 * detaches the session first and lets the person stop it (D-062). kehto retires every session of a
 * closed window and destroys its playback, so kernl hands kehto a wrapper whose `destroy` spares a
 * playback that was adopted a moment before.
 *
 * @param hooks - Where a kept session's changes are reported.
 * @returns The kept sessions.
 * @example
 * ```ts
 * const kept = createKeptSessions({ started: (id) => takeOver(id), changed: publish });
 * kept.end(kept.adopt(playback, snapshot));
 * ```
 */
export function createKeptSessions(hooks: KeptHooks): KeptSessions {
  const byPlayback = new Map<MediaPlayback, KeptSession>();

  function end(session: KeptSession): void {
    byPlayback.delete(session.playback);
    session.playback.destroy();
    hooks.changed();
  }

  return {
    adopt(playback, snapshot) {
      const id = `${snapshot.windowId}/${snapshot.sessionId}`;
      const kept: KeptSession = { id, from: snapshot.sessionId, playback, snapshot: { ...snapshot, sessionId: id, state: playback.state, actions: [...playback.actions] } };
      byPlayback.set(playback, kept);
      return kept;
    },
    wrap: (playback) => ({
      ...(playback.element ? { element: playback.element } : {}),
      get state() {
        return playback.state;
      },
      get actions() {
        return playback.actions;
      },
      command: (command) => playback.command(command),
      destroy() {
        if (!byPlayback.has(playback)) playback.destroy();
      },
    }),
    report(playback, state, actions) {
      const kept = byPlayback.get(playback);
      if (!kept) return false;
      const was = kept.snapshot.state?.status;
      kept.snapshot = { ...kept.snapshot, state, actions: [...actions] };
      if (state.status === 'playing' && was !== 'playing') hooks.started(kept.id);
      hooks.changed();
      return true;
    },
    get: (id) => [...byPlayback.values()].find((kept) => kept.id === id),
    all: () => [...byPlayback.values()],
    end,
    yieldTo(winner, takeover) {
      for (const kept of byPlayback.values()) {
        if (kept.id === winner || !ACTIVE.has(String(kept.snapshot.state?.status))) continue;
        if (takeover === 'end') end(kept);
        else kept.playback.command({ action: 'pause', reason: 'focus-lost' });
      }
    },
  };
}
