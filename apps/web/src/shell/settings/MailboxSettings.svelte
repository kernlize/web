<script lang="ts">
  import { onMount } from 'svelte';
  import type { MailboxState, PublishOutcome } from '@kernlize/core';
  import type { BootMode, ShellKernl } from '../contract';
  import { completionsFor, draftChanged, draftOf, progressWords, savedWords, suggestionsFor, withoutServer, withServer, type MailboxDraft, type MailboxSide } from '../mailbox-draft';
  import { observe } from '../observe.svelte';
  import { hostOf } from '../servers';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
  }

  const { kernl, mode }: Props = $props();

  const SIDES: readonly { id: MailboxSide; label: string; help: string; field: string }[] = [
    { id: 'inboxes', label: 'Inbox relays', help: 'Where others reach you.', field: 'Add an inbox relay' },
    { id: 'outboxes', label: 'Outbox relays', help: 'Where your posts are kept.', field: 'Add an outbox relay' },
  ];

  const published = observe<MailboxState>(kernl.mailboxes.state$, kernl.mailboxes.state());
  $effect(() => published.stop);
  const listings = observe(kernl.directory.listings$, kernl.directory.listings());
  $effect(() => listings.stop);

  let edited = $state.raw<MailboxDraft | undefined>(undefined);
  let typed = $state<Record<MailboxSide, string>>({ inboxes: '', outboxes: '' });
  let error = $state<string | null>(null);
  let saving = $state(false);
  let saved = $state<string | null>(null);

  const draft = $derived(edited ?? draftOf(published.value));
  const session = observe(kernl.session$, kernl.session);
  $effect(() => session.stop);
  const readOnly = $derived(session.value?.readOnly !== false);
  const canSave = $derived(draft !== undefined && !readOnly && !saving && draftChanged(draft, published.value) && (draft.inboxes.length > 0 || draft.outboxes.length > 0));

  onMount(() => {
    // Monitored relays complete what the person types; the subscription lives only while Settings is open.
    kernl.directory.start();
    return () => kernl.directory.stop();
  });

  function completions(side: MailboxSide): ReturnType<typeof completionsFor> {
    void listings.value;
    return draft ? completionsFor(kernl.directory, typed[side], draft[side]) : [];
  }

  function suggestions(side: MailboxSide): ReturnType<typeof suggestionsFor> {
    void listings.value;
    return draft ? suggestionsFor(kernl.directory, side, draft) : [];
  }

  function add(side: MailboxSide, input: string): void {
    if (!draft) return;
    error = null;
    saved = null;
    try {
      edited = withServer(draft, side, input);
      typed[side] = '';
    } catch {
      error = 'Enter a relay address such as nos.lol.';
    }
  }

  function remove(side: MailboxSide, url: string): void {
    if (!draft) return;
    saved = null;
    edited = withoutServer(draft, side, url);
  }

  async function save(): Promise<void> {
    if (!draft) return;
    saving = true;
    error = null;
    try {
      const { describeOutcome } = await import('@kernlize/core');
      const outcome: PublishOutcome = await kernl.mailboxes.save(draft, (sofar) => (saved = progressWords(sofar)));
      saved = savedWords(outcome, describeOutcome);
      if (outcome.ok) edited = undefined;
    } catch {
      error = 'The list could not be signed. Check your signer.';
    } finally {
      saving = false;
    }
  }
</script>

<section class="shell-section" aria-labelledby="mailboxes-heading">
  <h3 id="mailboxes-heading">Inbox and outbox</h3>
  <p class="shell-muted small">{mode === 'preview' ? 'Published only inside this tab.' : 'Published with your identity. Other apps use this list too.'}</p>

  {#if !draft}
    <p class="shell-muted" role="status">Looking for your inbox and outbox…</p>
  {:else}
    {#if published.value.status === 'missing'}
      <p class="small" role="status">Nothing published yet. These are suggestions.</p>
    {/if}
    {#if readOnly}<p class="shell-muted small">Read-only: this list cannot be changed.</p>{/if}
    <div class="sides">
      {#each SIDES as side (side.id)}
        {@const listId = `mailbox-${side.id}-completions`}
        <div class="shell-card side">
          <h4>{side.label}</h4>
          <p>{side.help}</p>
          <ul class="shell-list urls" aria-label={side.label}>
            {#each draft[side.id] as url (url)}
              <li data-address={url}>
                <span class="server">{hostOf(url)}</span>
                {#if !readOnly}<button type="button" class="shell-button quiet" onclick={() => remove(side.id, url)} aria-label="Remove {hostOf(url)} from {side.label}">Remove</button>{/if}
              </li>
            {:else}
              <li class="shell-muted">None yet.</li>
            {/each}
          </ul>
          {#if !readOnly}
            <form class="add" onsubmit={(event) => (event.preventDefault(), add(side.id, typed[side.id]))}>
              <label class="shell-field">
                <span>{side.field}</span>
                <input class="shell-input mono" type="text" inputmode="url" autocomplete="off" spellcheck="false" list={listId} bind:value={typed[side.id]} placeholder="nos.lol" />
              </label>
              <datalist id={listId}>
                {#each completions(side.id) as option (option.url)}<option value={option.url}>{option.label}</option>{/each}
              </datalist>
              <button type="submit" class="shell-button" disabled={!typed[side.id].trim()}>Add</button>
            </form>
            {@const offered = suggestions(side.id)}
            {#if offered.length}
              <div class="suggested" role="group" aria-label="Suggested for {side.label}">
                <span class="shell-muted small">Suggested:</span>
                {#each offered as option (option.url)}
                  <button type="button" class="bubble" onclick={() => add(side.id, option.url)} aria-label="Add {option.label} to {side.label}">+ {option.label}</button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
    {#if !readOnly}
      <div class="shell-actions">
        <button type="button" class="shell-button primary" onclick={save} disabled={!canSave}>{saving ? 'Publishing…' : 'Publish this list'}</button>
      </div>
    {/if}
  {/if}
  {#if saved}<p class="small" role="status">{saved}</p>{/if}
  {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
</section>

<style>
  .small {
    font-size: 0.85rem;
    margin: 0;
  }

  .sides {
    display: grid;
    gap: 0.75rem;
  }

  /* The window's own width, not the page's: Settings is resized and tiled on its own (D-049). */
  @container (min-width: 36rem) {
    .sides {
      grid-template-columns: 1fr 1fr;
    }
  }

  .urls li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    max-width: none;
  }

  .urls .server {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .add {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: 0.5rem;
  }

  .suggested {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  .bubble {
    border: 1px solid var(--line, currentColor);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    padding: 0.2rem 0.6rem;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
</style>
