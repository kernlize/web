<script lang="ts">
  import { shortId } from './contract';
  import type { Rect } from './layout';
  import { TITLE_BAR_HEIGHT, type ShellWindow, type WindowStore } from './window-store.svelte';

  interface Props {
    win: ShellWindow;
    windows: WindowStore;
    ongrants: (windowId: string) => void;
  }

  const { win, windows, ongrants }: Props = $props();
  const rect = $derived(windows.rectOf(win));
  const focused = $derived(windows.focusedId === win.id);
  const floating = $derived(windows.layout === 'floating');
  const title = $derived(win.plan.summary.title);

  type Mode = 'move' | 'resize';

  function track(event: PointerEvent, mode: Mode): void {
    if (!floating || event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    const start: Rect = { ...win.rect };
    const origin = { x: event.clientX, y: event.clientY };
    target.setPointerCapture(event.pointerId);
    windows.dragging = true;
    const onMove = (move: PointerEvent): void => {
      const dx = move.clientX - origin.x;
      const dy = move.clientY - origin.y;
      windows.move(win.id, mode === 'move' ? { ...start, x: start.x + dx, y: start.y + dy } : { ...start, width: start.width + dx, height: start.height + dy });
    };
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      windows.dragging = false;
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  function onTitleKeydown(event: KeyboardEvent): void {
    if (!floating) return;
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    windows.move(win.id, { ...window.rect, x: win.rect.x + delta[0], y: win.rect.y + delta[1] });
  }
</script>

<section
  class="window"
  class:focused
  class:hidden={win.minimised}
  class:revoked={Boolean(win.revoked)}
  aria-label="{title} window"
  data-window-id={win.id}
  data-status={win.status}
  style:left="{rect.x}px"
  style:top="{rect.y}px"
  style:width="{rect.width}px"
  style:height="{rect.height}px"
  style:z-index={win.z * 2}
  onpointerdowncapture={() => windows.focus(win.id)}
>
  <div
    class="title-bar"
    style:height="{TITLE_BAR_HEIGHT}px"
    role="toolbar"
    aria-label="{title} window controls"
    tabindex="-1"
    onpointerdown={(event) => (event.target as HTMLElement).closest('button') === null && track(event, 'move')}
    onkeydown={onTitleKeydown}
  >
    <span class="shell-badge" title="Applet identity">{shortId(win.plan.summary.identity.hash)}</span>
    <span class="title">{title}</span>
    <span class="status shell-muted">{win.status}</span>
    <div class="buttons">
      <button type="button" class="shell-button quiet" onclick={() => ongrants(win.id)} aria-label="Grants for {title}">Grants</button>
      <button type="button" class="shell-button quiet" onclick={() => windows.minimise(win.id)} aria-label="Minimise {title}">Minimise</button>
      <button type="button" class="shell-button quiet" onclick={() => windows.close(win.id)} aria-label="Close {title}">Close</button>
    </div>
  </div>
  <div class="body">
    {#if win.revoked}
      <div class="stopped">
        <p><strong>This applet was stopped.</strong></p>
        <p class="shell-muted">{win.revoked}</p>
        <button type="button" class="shell-button" onclick={() => windows.close(win.id)}>Close win</button>
      </div>
    {:else if win.status === 'mounting'}
      <p class="shell-muted starting">Starting {title}…</p>
    {/if}
  </div>
  {#if floating && !win.revoked}
    <button type="button" class="resize" aria-label="Resize {title}" onpointerdown={(event) => track(event, 'resize')}></button>
  {/if}
</section>

<style>
  .window {
    position: absolute;
    display: grid;
    grid-template-rows: auto 1fr;
    background: var(--bg-raised);
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
    pointer-events: auto;
    overflow: visible;
  }

  .window.focused {
    border-color: var(--accent);
    box-shadow: 0 16px 44px rgba(0, 0, 0, 0.4);
  }

  .window.hidden {
    display: none;
  }

  .title-bar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0 0.5rem 0 0.75rem;
    border-bottom: 1px solid var(--line);
    background: var(--bg);
    border-radius: 10px 10px 0 0;
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .title-bar:active {
    cursor: grabbing;
  }

  .title {
    font-weight: 600;
    font-size: 0.92rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    margin-left: auto;
  }

  .buttons {
    display: flex;
    gap: 0.1rem;
  }

  .buttons .shell-button {
    padding: 0.35rem 0.5rem;
    font-size: 0.72rem;
  }

  .body {
    position: relative;
    display: grid;
    place-items: center;
    border-radius: 0 0 10px 10px;
    background: var(--bg-raised);
  }

  .window.revoked .body {
    background: var(--bg-sunken);
  }

  .stopped {
    display: grid;
    gap: 0.4rem;
    text-align: center;
    padding: 1rem;
  }

  .stopped p {
    margin: 0;
  }

  .starting {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .resize {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: 18px;
    height: 18px;
    border: 0;
    background: transparent;
    cursor: nwse-resize;
    touch-action: none;
    z-index: 1;
  }

  .resize::after {
    content: '';
    position: absolute;
    right: 5px;
    bottom: 5px;
    width: 8px;
    height: 8px;
    border-right: 2px solid var(--line-strong);
    border-bottom: 2px solid var(--line-strong);
  }
</style>
