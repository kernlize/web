<script lang="ts">
  import { tick } from 'svelte';
  import { describeProvider, type ProviderEntry, type ReplyRule } from '@kernlize/messaging';
  import type { ShellKernl } from './contract';
  import { messagingError, unavailableWhy } from './messaging-reasons';
  import { REPLY_RULES, moved, settledWords } from './reply-words';

  interface Props {
    kernl: ShellKernl;
  }

  const { kernl }: Props = $props();
  const messaging = $derived(kernl.messaging);

  let providers = $state.raw<readonly ProviderEntry[]>(kernl.messaging.list());
  let preferences = $state.raw(kernl.messaging.preferences());
  let error = $state<string | null>(null);
  let moveNote = $state('');
  let section = $state<HTMLElement | null>(null);

  /**
   * Keep the keyboard where the user was. A control that a change disables or removes would
   * drop focus to the page, and the shell's own keys, Escape among them, would stop answering.
   */
  async function keepFocus(...selectors: string[]): Promise<void> {
    await tick();
    for (const selector of selectors) {
      const target = section?.querySelector<HTMLElement>(selector);
      if (target && !target.matches(':disabled')) return target.focus();
    }
  }

  const settled = $derived(Object.keys(preferences.replyChoices).length);

  /** Every change goes through here, so the list, the badges and the saved order never drift apart. */
  function apply(change: () => void): void {
    error = null;
    try {
      change();
    } catch (reason) {
      error = messagingError(reason);
    }
    providers = messaging.list();
    preferences = messaging.preferences();
  }

  function move(entry: ProviderEntry, step: -1 | 1): void {
    const order = moved(preferences.order, entry.provider.id, step);
    apply(() => messaging.setOrder(order));
    moveNote = `${entry.provider.name} is now number ${order.indexOf(entry.provider.id) + 1} of ${order.length}.`;
    const card = `[data-provider="${entry.provider.id}"]`;
    void keepFocus(`${card} [data-move="${step}"]`, `${card} [data-move="${-step}"]`);
  }

  function toggle(entry: ProviderEntry): void {
    const { id } = entry.provider;
    apply(() => (entry.enabled ? messaging.disable(id) : messaging.enable(id)));
    void keepFocus(`[data-provider="${id}"] [data-toggle]`);
  }

  function forget(): void {
    apply(() => messaging.forgetReplyChoice());
    void keepFocus('input[name="reply-rule"]:checked');
  }
</script>

<section class="shell-section" aria-labelledby="messaging-settings" bind:this={section}>
  <h3 id="messaging-settings">Messages</h3>
  <p class="shell-muted small">
    A message to someone new leaves through the first provider on this list that is switched on and can reach them. Each provider states what it protects. None is recommended over another: you put them in order.
  </p>
  <ol class="shell-list providers" aria-label="Providers, in your order">
    {#each providers as entry, index (entry.provider.id)}
      {@const id = entry.provider.id}
      <li class="shell-card provider" data-provider={id}>
        <div class="head">
          <span class="place" aria-hidden="true">{index + 1}</span>
          <h4>{entry.provider.name}</h4>
          {#if preferences.defaultProvider === id}
            <span class="shell-badge on">used first</span>
          {:else if entry.enabled}
            <span class="shell-badge on">on</span>
          {:else if !entry.availability.available}
            <span class="shell-badge warn">not available</span>
          {:else}
            <span class="shell-badge">off</span>
          {/if}
        </div>
        <p>{entry.provider.description}</p>
        {#if !entry.availability.available}
          <p class="reason">{unavailableWhy(entry.availability.reason)}</p>
        {/if}
        <details>
          <summary>What it protects</summary>
          <dl class="shell-rows">
            {#each describeProvider(entry.provider) as row (row.label)}
              <div><dt>{row.label}</dt><dd>{row.value}</dd></div>
            {/each}
          </dl>
        </details>
        <div class="shell-actions">
          <button type="button" class="shell-button quiet" data-move="-1" disabled={index === 0} onclick={() => move(entry, -1)} aria-label="Move {entry.provider.name} up">Move up</button>
          <button type="button" class="shell-button quiet" data-move="1" disabled={index === providers.length - 1} onclick={() => move(entry, 1)} aria-label="Move {entry.provider.name} down">Move down</button>
          {#if entry.enabled}
            <button type="button" class="shell-button" data-toggle onclick={() => toggle(entry)} aria-label="Switch off {entry.provider.name}">Switch off</button>
          {:else}
            <button type="button" class="shell-button" data-toggle disabled={!entry.availability.available} onclick={() => toggle(entry)} aria-label="Switch on {entry.provider.name}">Switch on</button>
          {/if}
        </div>
      </li>
    {/each}
  </ol>
  <p class="visually-hidden" role="status">{moveNote}</p>
  {#if error}<p class="shell-error" role="alert">{error}</p>{/if}

  <fieldset class="rules">
    <legend>When someone last wrote to you through a provider that is not first in your order</legend>
    {#each REPLY_RULES as rule (rule.id)}
      <label class="shell-card rule" class:active={preferences.reply === rule.id}>
        <input type="radio" name="reply-rule" value={rule.id} checked={preferences.reply === rule.id} onchange={() => apply(() => messaging.setReplyRule(rule.id as ReplyRule))} />
        <span class="name">{rule.label}</span>
        <small>{rule.help}</small>
      </label>
    {/each}
  </fieldset>
  {#if settled}
    <div class="settled">
      <p class="shell-muted small">{settledWords(settled)} Their answer comes before the rule above.</p>
      <button type="button" class="shell-button quiet" onclick={forget}>Forget those answers</button>
    </div>
  {/if}
</section>

<style>
  .small {
    font-size: 0.85rem;
    margin: 0;
  }

  .providers {
    padding: 0;
    gap: 0.6rem;
  }

  .providers li {
    max-width: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .head h4 {
    flex: 1;
  }

  .place {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    width: 1.5rem;
    height: 1.5rem;
    display: grid;
    place-items: center;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    color: var(--ink-muted);
  }

  .reason {
    font-size: 0.85rem;
    color: var(--ink-muted);
  }

  details summary {
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--ink-muted);
  }

  details[open] summary {
    margin-bottom: 0.4rem;
  }

  .rules {
    border: 0;
    padding: 0;
    margin: 0.5rem 0 0;
    display: grid;
    gap: 0.5rem;
  }

  .rules legend {
    font-size: 0.9rem;
    margin-bottom: 0.5rem;
  }

  .rule {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.6rem;
    align-items: center;
    cursor: pointer;
  }

  .rule.active {
    border-color: var(--accent);
  }

  .rule small {
    grid-column: 2;
    color: var(--ink-muted);
    font-size: 0.8rem;
  }

  .settled {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
