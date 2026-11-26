<script lang="ts">
  import Overlay from './Overlay.svelte';
  import type { TrafficLog } from './traffic-log.svelte';
  import { describeMarks, directionLabel, formatPayload, repeatWords } from './traffic-words';
  import type { ShellWindow } from './window-store.svelte';

  interface Props {
    win: ShellWindow;
    traffic: TrafficLog;
    onclose: () => void;
  }

  const { win, traffic, onclose }: Props = $props();
  let problemsOnly = $state(false);
  // A payload is formatted only once its row is opened: 200 at once would stall the page.
  let open = $state.raw<ReadonlySet<number>>(new Set());
  const toggle = (id: number, isOpen: boolean): void => {
    const next = new Set(open);
    if (isOpen) next.add(id);
    else next.delete(id);
    open = next;
  };
  const rows = $derived(traffic.forWindow(win.id));
  const shown = $derived(problemsOnly ? rows.filter((row) => row.mark) : rows);
  const total = $derived(traffic.total(win.id));
  const counted = $derived(traffic.marks(win.id));
  const marks = $derived(describeMarks(counted));
  // The counts cover the whole time the window has been open, the rows only the newest ones kept.
  const agedOut = $derived(problemsOnly && shown.length === 0 && counted.errors + counted.warnings > 0);
  const timeOf = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
        <li class="row" data-mark={row.mark ?? 'none'}>
          <details ontoggle={(event) => toggle(row.id, event.currentTarget.open)}>
            <summary>
              <time datetime={new Date(row.at).toISOString()}>{timeOf(row.at)}</time>
              <span class="direction">{directionLabel(row)}</span>
              <code class="type">{row.type}</code>
              {#if row.repeat}<span class="shell-badge repeats" title={repeatWords(row.repeat, timeOf)}>×{row.repeat.repeats}</span>{/if}
              {#if row.mark}<span class="shell-badge mark {row.mark}">{row.mark}</span>{/if}
              {#if row.note}<span class="row-note">{row.note}</span>{/if}
            </summary>
            {#if row.payload !== undefined && open.has(row.id)}
              <pre>{formatPayload(row.payload)}</pre>
            {/if}
          </details>
        </li>
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

  .row {
    max-width: none;
    border-left: 3px solid transparent;
    padding: 0.2rem 0.5rem;
    background: var(--bg);
  }

  .row[data-mark='error'] {
    border-left-color: #e07a5f;
  }

  .row[data-mark='warning'] {
    border-left-color: var(--accent);
  }

  summary {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: baseline;
    cursor: pointer;
  }

  time,
  .direction {
    color: var(--ink-muted);
    font-family: var(--font-mono);
    white-space: nowrap;
  }

  .type {
    font-weight: 600;
  }

  .mark.error {
    color: #e07a5f;
  }

  .repeats {
    color: var(--ink-muted);
    font-family: var(--font-mono);
  }

  .mark.warning {
    color: var(--accent);
  }

  .row-note {
    color: var(--ink-muted);
  }

  pre {
    margin: 0.4rem 0 0.2rem;
    padding: 0.5rem;
    max-height: 16rem;
    overflow: auto;
    background: var(--bg-raised);
    border-radius: 6px;
    font-size: 0.78rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
