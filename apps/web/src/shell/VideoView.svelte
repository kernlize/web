<script lang="ts">
  import type { MediaSessionView } from '@kernlize/core';
  import type { ShellKernl } from './contract';
  import MediaRow from './MediaRow.svelte';

  interface Props {
    kernl: ShellKernl;
    session: MediaSessionView | undefined;
    applet: string;
  }

  const { kernl, session, applet }: Props = $props();
  const element = $derived(session ? kernl.media.element(session.sessionId) : undefined);

  /** Moved here, as in the player's own box; see `MediaRow`. */
  function show(box: HTMLElement, value: HTMLMediaElement | undefined) {
    let current = value;
    if (current) box.append(current);
    return {
      update(next: HTMLMediaElement | undefined) {
        if (next === current) return;
        if (current?.parentNode === box) current.remove();
        current = next;
        if (current) box.append(current);
      },
      destroy() {
        if (current?.parentNode === box) current.remove();
      },
    };
  }
</script>

<div class="video-view">
  <div class="screen" use:show={element}></div>
  {#if session}
    <MediaRow {session} {applet} oncommand={(command) => kernl.media.command(session.sessionId, command)} onend={() => kernl.media.end(session.sessionId)} />
  {/if}
</div>

<style>
  .video-view {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    border-radius: inherit;
    overflow: hidden;
  }

  .screen {
    background: #000;
    min-height: 0;
  }

  .screen :global(video) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
