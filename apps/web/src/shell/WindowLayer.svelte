<script lang="ts">
  import AppletWindow from './AppletWindow.svelte';
  import type { WindowStore } from './window-store.svelte';

  const { windows, ongrants }: { windows: WindowStore; ongrants: (windowId: string) => void } = $props();
</script>

<div class="chrome">
  {#each windows.windows as win (win.id)}
    <AppletWindow {win} {windows} {ongrants} />
  {/each}
</div>

<style>
  .chrome {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
</style>
