<script lang="ts">
  import type { MediaSessionView, MediaUserCommand } from '@kernlize/core';
  import { fullscreenLabel, isPlaying, mediaLine, mediaTime, mediaTitle, toggleFullscreen } from './media-words';

  interface Props {
    session: MediaSessionView;
    /** The name of the applet that plays it. */
    applet: string;
    /** The element to show the video in, when it is shown here. */
    screen?: HTMLMediaElement | undefined;
    /** A row in the list of the others: title, play and end only. */
    brief?: boolean;
    oncommand: (command: MediaUserCommand) => void;
    onend: () => void;
    /** Bring the video's own window forward, when it has one. */
    onshow?: (() => void) | undefined;
    /** Fill the screen with the box this row's video is in, when it is not this row's own. */
    onfullscreen?: (() => void) | undefined;
  }

  const { session, applet, screen, brief = false, oncommand, onend, onshow, onfullscreen }: Props = $props();
  let holder = $state<HTMLElement | null>(null);
  let full = $state(false);
  // A docked video fills the screen with its row; a windowed one with the box its window gives it.
  const fills = $derived(!brief && (screen !== undefined || onfullscreen !== undefined));

  $effect(() => {
    const changed = (): void => {
      full = document.fullscreenElement !== null && document.fullscreenElement.contains(holder);
    };
    changed();
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  });

  function fillScreen(): void {
    if (onfullscreen) onfullscreen();
    else if (holder) void toggleFullscreen(holder, document);
  }
  const title = $derived(mediaTitle(session));
  const can = $derived(new Set(session.actions));
  const playing = $derived(isPlaying(session));
  const duration = $derived(session.state?.duration ?? session.metadata?.duration ?? 0);

  /**
   * Put the session's element in this box. It is moved, never copied: the same element keeps
   * playing wherever it is shown, and leaving a box does not take it out of the one it moved to.
   */
  function show(box: HTMLElement, element: HTMLMediaElement | undefined) {
    let current = element;
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

  const toggle = (): void => oncommand({ action: playing ? 'pause' : 'play' });
</script>

<div class="holder" bind:this={holder}>
<div class="row" class:brief class:current={session.current} class:with-screen={screen !== undefined} role="group" aria-label={title} data-session={session.sessionId} data-status={session.state?.status ?? 'paused'}>
  {#if screen}
    <div class="screen" use:show={screen}></div>
  {/if}
  <div class="info">
    <strong class="title">{title}</strong>
    <small class="line">{mediaLine(session, applet)}</small>
  </div>
  <div class="transport">
    {#if !brief && can.has('prev')}<button type="button" class="shell-button quiet" onclick={() => oncommand({ action: 'prev' })}>Previous</button>{/if}
    <button type="button" class="shell-button" class:primary={!brief} disabled={!can.has(playing ? 'pause' : 'play')} onclick={toggle} aria-label="{playing ? 'Pause' : 'Play'} {title}">{playing ? 'Pause' : 'Play'}</button>
    {#if !brief && can.has('next')}<button type="button" class="shell-button quiet" onclick={() => oncommand({ action: 'next' })}>Next</button>{/if}
    {#if onshow}<button type="button" class="shell-button quiet" onclick={onshow}>Show</button>{/if}
    {#if fills}<button type="button" class="shell-button quiet" onclick={fillScreen} aria-label="{fullscreenLabel(full)}: {title}">{fullscreenLabel(full)}</button>{/if}
    <button type="button" class="shell-button quiet" onclick={onend} aria-label="End {title}">End</button>
  </div>
  {#if !brief}
    <div class="sliders">
      {#if can.has('seek') && duration > 0}
        <label class="slider seek">
          <span class="time">{mediaTime(session.state?.position)}</span>
          <input type="range" min="0" max={duration} step="any" value={session.state?.position ?? 0} aria-label="Position in {title}" onchange={(event) => oncommand({ action: 'seek', value: Number(event.currentTarget.value) })} />
          <span class="time">{mediaTime(duration)}</span>
        </label>
      {/if}
      {#if can.has('volume')}
        <label class="slider volume">
          <span class="time">Volume</span>
          <input type="range" min="0" max="1" step="0.05" value={session.state?.volume ?? 1} aria-label="Volume of {title}" oninput={(event) => oncommand({ action: 'volume', value: Number(event.currentTarget.value) })} />
        </label>
      {/if}
    </div>
  {/if}
</div>
</div>

<style>
  .holder {
    container: media-row / inline-size;
  }

  /* A docked video filling the screen: the picture takes the screen, the shell's controls stay under it. */
  .holder:fullscreen {
    position: relative;
    background: var(--bg);
    color: var(--ink);
  }

  .holder:fullscreen .row {
    position: absolute;
    inset: 0;
  }

  .holder:fullscreen .row.with-screen {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: minmax(0, 1fr) auto auto;
    grid-template-areas: 'screen screen' 'info transport' 'sliders sliders';
    padding: 0 1rem 1rem;
  }

  .holder:fullscreen .screen {
    position: relative;
    align-self: stretch;
    min-height: 0;
    aspect-ratio: auto;
    border-radius: 0;
    margin: 0 -1rem;
  }

  /* Sized by the screen's share of the grid, never by the video's own height. */
  .holder:fullscreen .screen :global(video) {
    position: absolute;
    inset: 0;
  }


  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'info transport' 'sliders sliders';
    align-items: center;
    gap: 0.35rem 0.75rem;
    padding: 0.5rem 0.75rem;
  }

  .row.with-screen {
    grid-template-columns: 12rem minmax(0, 1fr) auto;
    grid-template-areas: 'screen info transport' 'screen sliders sliders';
  }

  .row.brief {
    grid-template-areas: 'info transport';
    padding: 0.35rem 0.75rem;
  }

  .screen {
    grid-area: screen;
    aspect-ratio: 16 / 9;
    background: #000;
    border-radius: 6px;
    overflow: hidden;
  }

  .screen :global(video) {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .info {
    grid-area: info;
    display: grid;
    min-width: 0;
  }

  .title,
  .line {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .title {
    font-size: 0.9rem;
  }

  .line {
    font-size: 0.78rem;
    color: var(--ink-muted);
  }

  .transport {
    grid-area: transport;
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .sliders {
    grid-area: sliders;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 12rem;
    gap: 1rem;
  }

  .slider {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .slider.volume {
    grid-column: 2;
  }

  .slider input {
    flex: 1;
    min-width: 0;
    accent-color: var(--accent);
  }

  .time {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--ink-muted);
  }

  /* A phone-width row: the screen above, then the title and buttons, and only the position slider. */
  @container media-row (max-width: 34rem) {
    .row.with-screen {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas: 'screen screen' 'info transport' 'sliders sliders';
    }

    .sliders {
      grid-template-columns: minmax(0, 1fr);
    }

    .slider.volume {
      display: none;
    }
  }
</style>
