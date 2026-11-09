<script lang="ts">
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import type { ShellKernl } from './contract';
  import type { WindowStore } from './window-store.svelte';

  const { kernl, windows }: { kernl: ShellKernl; windows: WindowStore } = $props();

  const attachments = new Map<string, Attachment<HTMLIFrameElement>>();

  /**
   * Mount exactly once per frame node. The node is never moved: moving an iframe reloads it. One
   * attachment is kept per window, so a redraw of the list hands Svelte the same function and it
   * does not run again.
   */
  const attachFrame = (id: string): Attachment<HTMLIFrameElement> => {
    const known = attachments.get(id);
    if (known) return known;
    const attachment: Attachment<HTMLIFrameElement> = (frame) => {
      untrack(() => windows.attach(id, frame, (plan, element) => kernl.mount(plan, element)));
      return () => attachments.delete(id);
    };
    attachments.set(id, attachment);
    return attachment;
  };

  /** Clicking inside an iframe never reaches the shell; the focus change does. */
  const onWindowBlur = (): void => {
    queueMicrotask(() => {
      const active = document.activeElement;
      if (active instanceof HTMLIFrameElement && active.dataset.windowId) windows.focus(active.dataset.windowId);
    });
  };
</script>

<svelte:window onblur={onWindowBlur} />

<div class="frames">
  {#each windows.windows as win (win.id)}
    {@const rect = windows.frameRectOf(win)}
    {@const shown = !win.minimised && !win.stopped}
    <iframe
      title="{win.plan.summary.title} applet"
      sandbox="allow-scripts"
      data-window-id={win.id}
      style:left="{rect.x}px"
      style:top="{rect.y}px"
      style:width="{rect.w}px"
      style:height="{rect.h}px"
      style:z-index={win.z * 2 + 1}
      style:visibility={shown ? 'visible' : 'hidden'}
      style:pointer-events={windows.dragging ? 'none' : 'auto'}
      {@attach attachFrame(win.id)}
    ></iframe>
  {/each}
</div>

<style>
  .frames {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  iframe {
    position: absolute;
    border: 0;
    background: var(--bg-raised);
    border-radius: 0 0 10px 10px;
  }
</style>
