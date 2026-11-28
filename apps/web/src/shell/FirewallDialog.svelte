<script lang="ts">
  import type { FirewallChoice, FirewallPrompt } from './contract';
  import { shortId } from './contract';
  import { choiceWords, firewallLines, firewallNote, firewallTitle, isAppletLink } from './firewall-words';
  import { trapFocus } from './focus-trap';

  interface Props {
    prompt: Pick<FirewallPrompt, 'summary'>;
    /** How many more questions wait behind this one. */
    waiting: number;
    onanswer: (choice: FirewallChoice | undefined) => void;
  }

  const { prompt, waiting, onanswer }: Props = $props();
  const summary = $derived(prompt.summary);
  const internal = $derived(isAppletLink(summary));
  const allows = $derived(summary.choices.filter((choice) => choice !== 'deny'));
  let denyButton = $state<HTMLButtonElement | null>(null);
</script>

<div class="backdrop">
  <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="firewall-title" aria-describedby="firewall-lines firewall-note" data-kind={summary.kind} {@attach trapFocus(() => denyButton)}>
    <p class="who">
      <span class="shell-badge">{shortId(summary.applet.identity.hash)}</span>
      {summary.applet.title} wants to
      <span class="shell-badge warn">firewall</span>
    </p>
    <h2 id="firewall-title">{firewallTitle(summary)}</h2>
    <dl id="firewall-lines" class="lines">
      {#each firewallLines(summary) as line, index (index)}
        <div><dt>{line.label}</dt><dd>{line.value}</dd></div>
      {/each}
    </dl>
    <p id="firewall-note" class="shell-muted note">{internal ? 'This looks up another applet. You can review its permissions before opening it.' : firewallNote(summary.kind)}</p>
    {#if waiting > 0}<p class="shell-muted note" role="status">{waiting} more {waiting === 1 ? 'question is' : 'questions are'} waiting.</p>{/if}
    <div class="shell-actions">
      <button type="button" class="shell-button" bind:this={denyButton} onclick={() => onanswer('deny')}>{internal ? 'Cancel' : choiceWords('deny', summary.kind)}</button>
      {#each allows as choice, index (choice)}
        <button type="button" class="shell-button" class:primary={index === 0} onclick={() => onanswer(choice)}>{internal ? 'Look up applet' : choiceWords(choice, summary.kind)}</button>
      {/each}
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
    border-top: 3px solid var(--accent);
    border-radius: var(--radius);
    padding: 1.25rem 1.5rem 1.5rem;
    display: grid;
    gap: 0.9rem;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45);
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
    grid-template-columns: 6rem 1fr;
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
    overflow-wrap: anywhere;
  }

  .note {
    margin: 0;
    font-size: 0.85rem;
  }

  .shell-actions {
    justify-content: flex-end;
    flex-wrap: wrap;
  }
</style>
