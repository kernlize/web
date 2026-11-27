<script lang="ts">
  import { directionLabel, formatPayload, repeatWords, type TrafficEntry } from './traffic-words';

  const { row }: { row: TrafficEntry } = $props();
  let payload = $state<string>();
  // Take a snapshot on opening so a live stream doesn't change the text while it's being read.
  const toggle = (event: Event & { currentTarget: HTMLDetailsElement }): void => {
    payload = event.currentTarget.open && row.payload !== undefined ? formatPayload(row.payload) : undefined;
  };
  const timeOf = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

<li class="row" data-mark={row.mark ?? 'none'}>
  <details ontoggle={toggle}>
    <summary>
      <time datetime={new Date(row.at).toISOString()}>{timeOf(row.at)}</time>
      <span class="direction">{directionLabel(row)}</span>
      <code class="type">{row.type}</code>
      {#if row.repeat}<span class="shell-badge repeats" title={repeatWords(row.repeat, timeOf)}>×{row.repeat.repeats}</span>{/if}
      {#if row.mark}<span class="shell-badge mark {row.mark}">{row.mark}</span>{/if}
      {#if row.note}<span class="row-note">{row.note}</span>{/if}
    </summary>
    {#if payload !== undefined}<pre>{payload}</pre>{/if}
  </details>
</li>

<style>
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
