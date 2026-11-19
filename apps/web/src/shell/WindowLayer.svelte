<script lang="ts">
  import type { Snippet } from 'svelte';
  import AppletWindow from './AppletWindow.svelte';
  import WindowFrame from './WindowFrame.svelte';
  import type { PanelWindow, WindowStore } from './window-store.svelte';

  interface Props {
    windows: WindowStore;
    ongrants: (windowId: string) => void;
    /** What goes inside a window the shell draws itself. */
    panel: Snippet<[PanelWindow]>;
  }

  const { windows, ongrants, panel }: Props = $props();
</script>

<div class="chrome">
  {#each windows.windows as win (win.id)}
    <AppletWindow {win} {windows} {ongrants} />
  {/each}
  {#each windows.panels as win (win.id)}
    <WindowFrame {win} {windows} title={win.title} scrolls>
      {@render panel(win)}
    </WindowFrame>
  {/each}
</div>

<style>
  .chrome {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>
