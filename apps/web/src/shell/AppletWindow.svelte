<script lang="ts">
  import { shortId } from './contract';
  import WindowFrame from './WindowFrame.svelte';
  import type { StopCause } from './stop-words';
  import type { ShellWindow, WindowStore } from './window-store.svelte';

  interface Props {
    win: ShellWindow;
    windows: WindowStore;
    ongrants: (windowId: string) => void;
    onreload: (windowId: string) => void;
  }

  const { win, windows, ongrants, onreload }: Props = $props();
  const title = $derived(win.plan.summary.title);
  const BY: Readonly<Record<StopCause, string>> = { applet: 'The applet', you: 'You', shell: 'The shell' };
</script>

<WindowFrame {win} {windows} {title} status={win.status} revoked={Boolean(win.revoked)}>
  {#snippet lead()}
    <span class="shell-badge" title="Applet identity">{shortId(win.plan.summary.identity.hash)}</span>
  {/snippet}
  {#snippet actions()}
    {#if !win.revoked}<button type="button" class="shell-button quiet" onclick={() => onreload(win.id)} aria-label="Reload {title}">Reload</button>{/if}
    <button type="button" class="shell-button quiet" onclick={() => ongrants(win.id)} aria-label="Grants for {title}">Grants</button>
  {/snippet}
  {#if win.revoked}
    {@const stop = win.revoked}
    <div class="stopped">
      <p><strong>This applet was stopped.</strong></p>
      <p class="shell-muted" data-testid="stop-words">{stop.words}</p>
      <div class="actions">
        {#if stop.code !== 'blocked'}<button type="button" class="shell-button primary" onclick={() => onreload(win.id)}>Reload</button>{/if}
        <button type="button" class="shell-button" onclick={() => windows.close(win.id)}>Close window</button>
      </div>
      <details class="why">
        <summary>Details</summary>
        <dl>
          {#if stop.by}<dt>By</dt><dd>{BY[stop.by]}</dd>{/if}
          {#if stop.limit}<dt>Limit</dt><dd>{stop.limit}</dd>{/if}
          <dt>Next</dt><dd>{stop.next}</dd>
          <dt>Code</dt><dd><code>{stop.code}</code></dd>
          {#if stop.detail}<dt>Detail</dt><dd><code>{stop.detail}</code></dd>{/if}
          <dt>At</dt><dd><time datetime={new Date(stop.at).toISOString()}>{new Date(stop.at).toLocaleTimeString()}</time></dd>
        </dl>
      </details>
    </div>
  {:else if win.status === 'mounting'}
    <p class="shell-muted starting">Starting {title}…</p>
  {/if}
</WindowFrame>

<style>
  .stopped {
    display: grid;
    justify-items: center;
    gap: 0.4rem;
    text-align: center;
    padding: 1rem;
  }

  .stopped p {
    margin: 0;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .why {
    max-width: 32rem;
    text-align: left;
    font-size: 0.85rem;
  }

  .why summary {
    cursor: pointer;
    color: var(--ink-muted);
    text-align: center;
  }

  .why dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 0.75rem;
    margin: 0.5rem 0 0;
    user-select: text;
  }

  .why dt {
    color: var(--ink-muted);
  }

  .why dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .starting {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
</style>
