<script lang="ts">
  import type { ConsentPrompt } from './contract';
  import { shortId } from './contract';
  import { trapFocus } from './focus-trap';
  import { eventDetails } from './event-details';

  interface Props {
    prompt: ConsentPrompt;
    appletTitle: string;
    onanswer: (allowed: boolean) => void;
  }

  const { prompt, appletTitle, onanswer }: Props = $props();
  const summary = $derived(prompt.summary);
  let denyButton = $state<HTMLButtonElement | null>(null);
  let advanced = $state(false);
</script>

<div class="backdrop">
  <section
    class="dialog"
    class:destructive={summary.severity === 'destructive'}
    role="dialog"
    aria-modal="true"
    aria-labelledby="consent-title"
    aria-describedby="consent-lines"
    {@attach trapFocus(() => denyButton)}
  >
    <p class="who">
      <span class="shell-badge">{shortId(summary.applet.hash)}</span>
      {appletTitle} wants to
      {#if summary.severity === 'destructive'}<span class="shell-badge warn">destructive</span>{/if}
    </p>
    <h2 id="consent-title">{summary.title}</h2>
    <dl id="consent-lines" class="lines">
      {#each summary.lines as line, index (index)}
        <div>
          <dt>{line.label}</dt>
          <dd>
            {#if line.before !== undefined}<s>{line.before}</s>{/if}
            {#if line.after !== undefined}<span>{line.after}</span>{/if}
          </dd>
        </div>
      {/each}
    </dl>
    <details bind:open={advanced}>
      <summary>Advanced: the exact record</summary>
      <dl class="record">
        {#each eventDetails(summary.event) as row, index (index)}
          <div><dt>{row.label}</dt><dd>{row.value}</dd></div>
        {/each}
      </dl>
    </details>
    <div class="shell-actions">
      <button type="button" class="shell-button" bind:this={denyButton} onclick={() => onanswer(false)}>Deny</button>
      <button type="button" class="shell-button primary" onclick={() => onanswer(true)}>Allow</button>
    </div>
  </section>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 300;
    background: color-mix(in srgb, var(--bg-sunken) 70%, transparent);
    display: grid;
    place-items: center;
    padding: 1rem;
  }

  .dialog {
    width: min(100%, 30rem);
    background: var(--bg-raised);
    border: 1px solid var(--line-strong);
    border-top: 3px solid var(--ok);
    border-radius: var(--radius);
    padding: 1.25rem 1.5rem 1.5rem;
    display: grid;
    gap: 0.9rem;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
  }

  .dialog.destructive {
    border-top-color: var(--accent);
  }

  .who {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--ink-muted);
  }

  h2 {
    margin: 0;
    font-size: 1.4rem;
  }

  .lines {
    margin: 0;
    display: grid;
    border-top: 1px solid var(--line);
  }

  .lines > div {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 1rem;
    padding: 0.55rem 0;
    border-bottom: 1px solid var(--line);
  }

  dt {
    color: var(--ink-muted);
    font-size: 0.9rem;
  }

  dd {
    margin: 0;
    display: grid;
    gap: 0.2rem;
    overflow-wrap: anywhere;
  }

  s {
    color: var(--ink-muted);
  }

  details {
    font-size: 0.85rem;
  }

  summary {
    cursor: pointer;
    font-family: var(--font-mono);
    color: var(--ink-muted);
  }

  .record {
    margin: 0.5rem 0 0;
    max-height: 12rem;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    background: var(--bg-sunken);
    border-radius: 8px;
    padding: 0.75rem;
    display: grid;
    gap: 0.35rem;
  }

  .record div {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.75rem;
  }

  .record dt {
    color: var(--ink-muted);
  }

  .record dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .shell-actions {
    justify-content: flex-end;
  }
</style>
