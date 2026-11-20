<script lang="ts">
  import { shortId } from './contract';
  import WindowFrame from './WindowFrame.svelte';
  import { describeMarks, type TrafficMarks } from './traffic-words';
  import type { ShellWindow, WindowStore } from './window-store.svelte';

  interface Props {
    win: ShellWindow;
    windows: WindowStore;
    ongrants: (windowId: string) => void;
    oninspect: (windowId: string) => void;
    /** Errors and warnings in this applet's messages, for the chrome's Inspect button. */
    marks: TrafficMarks;
  }

  const { win, windows, ongrants, oninspect, marks }: Props = $props();
  const title = $derived(win.plan.summary.title);
  const problems = $derived(marks.errors + marks.warnings);
  const problemWords = $derived(describeMarks(marks));
</script>

<WindowFrame {win} {windows} {title} status={win.status} revoked={Boolean(win.revoked)}>
  {#snippet lead()}
    <span class="shell-badge" title="Applet identity">{shortId(win.plan.summary.identity.hash)}</span>
  {/snippet}
  {#snippet actions()}
    <button type="button" class="shell-button quiet inspect" class:errors={marks.errors > 0} onclick={() => oninspect(win.id)} aria-label="Inspect {title}{problemWords ? `, ${problemWords}` : ''}" title={problemWords || undefined}>Inspect{#if problems > 0}<span class="count" data-testid="inspect-count">{problems}</span>{/if}</button>
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

  .inspect .count {
    margin-left: 0.35rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: var(--accent);
    color: var(--bg);
    font-size: 0.72rem;
  }

  .inspect.errors .count {
    background: #e07a5f;
  }

  .starting {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
</style>
