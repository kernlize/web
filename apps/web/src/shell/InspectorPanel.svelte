<script lang="ts">
  import InspectorRow from './InspectorRow.svelte';
  import Overlay from './Overlay.svelte';
  import type { TrafficLog } from './traffic-log.svelte';
  import { describeMarks } from './traffic-words';
  import type { ShellWindow } from './window-store.svelte';

  interface Props {
    win: ShellWindow;
    traffic: TrafficLog;
    onclose: () => void;
  }

  const { win, traffic, onclose }: Props = $props();
  let problemsOnly = $state(false);
  const rows = $derived(traffic.forWindow(win.id));
  const shown = $derived(problemsOnly ? rows.filter((row) => row.mark) : rows);
  const total = $derived(traffic.total(win.id));
  const counted = $derived(traffic.marks(win.id));
  const marks = $derived(describeMarks(counted));
  // The counts cover the whole time the window has been open, the rows only the newest ones kept.
  const agedOut = $derived(problemsOnly && shown.length === 0 && counted.errors + counted.warnings > 0);
</script>

<Overlay title="Inspect {win.plan.summary.title}" {onclose} wide>
  <div class="bar">
    <p class="shell-muted" data-testid="traffic-summary">{total} {total === 1 ? 'message' : 'messages'}{marks ? ` · ${marks}` : ''}</p>
    <label class="filter"><input type="checkbox" bind:checked={problemsOnly} /> Problems only</label>
  </div>
  {#if shown.length === 0}
    <p class="shell-muted">{agedOut ? 'No problems among the messages kept.' : problemsOnly ? 'No problems.' : 'Nothing yet.'}</p>
  {:else}
    <ol class="log" aria-label="Messages, newest first">
      {#each shown as row (row.id)}
        <InspectorRow {row} />
      {/each}
    </ol>
  {/if}
</Overlay>

<style>
  .bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }

  .bar p {
    margin: 0;
  }

  .filter {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    font-size: 0.85rem;
  }

  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
    font-size: 0.82rem;
  }
</style>
