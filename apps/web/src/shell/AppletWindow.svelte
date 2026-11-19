<script lang="ts">
  import { shortId } from './contract';
  import WindowFrame from './WindowFrame.svelte';
  import type { ShellWindow, WindowStore } from './window-store.svelte';

  interface Props {
    win: ShellWindow;
    windows: WindowStore;
    ongrants: (windowId: string) => void;
  }

  const { win, windows, ongrants }: Props = $props();
  const title = $derived(win.plan.summary.title);
</script>

<WindowFrame {win} {windows} {title} status={win.status} revoked={Boolean(win.revoked)}>
  {#snippet lead()}
    <span class="shell-badge" title="Applet identity">{shortId(win.plan.summary.identity.hash)}</span>
  {/snippet}
  {#snippet actions()}
    <button type="button" class="shell-button quiet" onclick={() => ongrants(win.id)} aria-label="Grants for {title}">Grants</button>
  {/snippet}
  {#if win.revoked}
    <div class="stopped">
      <p><strong>This applet was stopped.</strong></p>
      <p class="shell-muted">{win.revoked}</p>
      <button type="button" class="shell-button" onclick={() => windows.close(win.id)}>Close window</button>
    </div>
  {:else if win.status === 'mounting'}
    <p class="shell-muted starting">Starting {title}…</p>
  {/if}
</WindowFrame>

<style>
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
</style>
