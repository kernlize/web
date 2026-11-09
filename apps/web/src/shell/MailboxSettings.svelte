<script lang="ts">
  import { onMount } from 'svelte';
  import type { MailboxState, PublishOutcome } from '@kernlize/core';
  import type { BootMode, ShellKernl } from './contract';
  import { completionsFor, draftChanged, draftOf, savedWords, suggestionsFor, withoutServer, withServer, type MailboxDraft, type MailboxSide } from './mailbox-draft';
  import { observe } from './observe.svelte';
  import { serverName } from './servers';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
  }

  const { kernl, mode }: Props = $props();

  const SIDES: readonly { id: MailboxSide; label: string; help: string; field: string }[] = [
    { id: 'inboxes', label: 'Inbox', help: 'Where people send things to you: replies, mentions and messages.', field: 'Add an inbox server' },
    { id: 'outboxes', label: 'Outbox', help: 'Where your posts are kept, and where others look for them.', field: 'Add an outbox server' },
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
    // Monitored servers complete what the person types; the subscription lives only while Settings is open.
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
      error = 'Enter a server address such as nos.lol.';
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
      const outcome: PublishOutcome = await kernl.mailboxes.save(draft);
      saved = savedWords(outcome, describeOutcome);
      if (outcome.ok) edited = undefined;
    } catch {
      error = 'The list could not be signed. Check that your signer is open, then try again.';
    } finally {
      saving = false;
    }
  }
</script>

<section class="shell-section" aria-labelledby="mailboxes-heading">
  <h3 id="mailboxes-heading">Inbox and outbox</h3>
  <p class="shell-muted small">
    The servers that carry your posts and messages. Other apps read this same list, so a change here follows your account everywhere. Pictures and applet files live on separate file servers.
  </p>
  {#if mode === 'preview'}<p class="shell-muted small">The preview keeps this list in the page and sends it nowhere.</p>{/if}

  {#if !draft}
    <p class="shell-muted" role="status">Looking for your inbox and outbox…</p>
  {:else}
    {#if published.value.status === 'missing'}
      <p class="small" role="status">This account has not said where it can be reached yet. The servers below are suggested; change them if you like, then publish the list.</p>
    {/if}
    {#if readOnly}<p class="shell-muted small">Signed in read-only: you can see this list but not change it.</p>{/if}
    <div class="sides">
      {#each SIDES as side (side.id)}
        {@const listId = `mailbox-${side.id}-completions`}
        <div class="shell-card side">
          <h4>{side.label}</h4>
          <p>{side.help}</p>
          <ul class="shell-list urls" aria-label="{side.label} servers">
            {#each draft[side.id] as url (url)}
              <li data-address={url}>
                <span class="server">{serverName(url)}</span>
                {#if !readOnly}<button type="button" class="shell-button quiet" onclick={() => remove(side.id, url)} aria-label="Remove {serverName(url)} from {side.label}">Remove</button>{/if}
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

  @media (min-width: 760px) {
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
