<script lang="ts">
  import type { MediaSessionView, MediaSettings } from '@kernlize/core';
  import type { ShellKernl } from './contract';
  import MediaRow from './MediaRow.svelte';

  interface Props {
    kernl: ShellKernl;
    sessions: readonly MediaSessionView[];
    settings: MediaSettings;
    /** The name of the applet in a window. */
    appletOf: (windowId: string) => string;
    /** Bring a video's own window forward. */
    onshow: (sessionId: string) => void;
  }

  const { kernl, sessions, settings, appletOf, onshow }: Props = $props();

  // One at a time: the current session in full, the rest listed briefly. Several: every session in full, newest first.
  const shown = $derived(settings.concurrency === 'one' ? sessions.filter((session) => session.current) : [...sessions].reverse());
  const others = $derived(settings.concurrency === 'one' ? sessions.filter((session) => !session.current).reverse() : []);
  const playingCount = $derived(sessions.filter((session) => session.state?.status === 'playing').length);
  let open = $state(false);

  const screenOf = (session: MediaSessionView): HTMLMediaElement | undefined => (session.video && settings.video === 'docked' ? kernl.media.element(session.sessionId) : undefined);
  const showOf = (session: MediaSessionView): (() => void) | undefined => (session.video && settings.video === 'window' ? () => onshow(session.sessionId) : undefined);
</script>

{#if sessions.length}
  <section class="media-bar" aria-label="Media player" data-count={sessions.length} data-playing={playingCount}>
    <div class="rows">
      {#each shown as session (session.sessionId)}
        <MediaRow {session} applet={appletOf(session.windowId)} screen={screenOf(session)} onshow={showOf(session)} oncommand={(command) => kernl.media.command(session.sessionId, command)} onend={() => kernl.media.end(session.sessionId)} />
      {/each}
    </div>
    {#if others.length}
      <details class="others" bind:open>
        <summary>{others.length} more</summary>
        <div class="rows">
          {#each others as session (session.sessionId)}
            <MediaRow {session} brief applet={appletOf(session.windowId)} onshow={showOf(session)} oncommand={(command) => kernl.media.command(session.sessionId, command)} onend={() => kernl.media.end(session.sessionId)} />
          {/each}
        </div>
      </details>
    {/if}
  </section>
{/if}

<style>
  .media-bar {
    position: relative;
    z-index: 5;
    max-height: 45vh;
    overflow: auto;
    background: var(--panel, var(--bg));
    border-top: 1px solid var(--line-strong);
    box-shadow: 0 -6px 18px color-mix(in srgb, var(--ink) 8%, transparent);
  }

  .rows > :global(* + *) {
    border-top: 1px solid var(--line);
  }

  .others {
    border-top: 1px solid var(--line);
  }

  .others summary {
    cursor: pointer;
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    color: var(--ink-muted);
  }
</style>
