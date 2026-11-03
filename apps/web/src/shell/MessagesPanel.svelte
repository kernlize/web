<script lang="ts">
  import type { DmConversation, DmMessage } from '@napplet/core';
  import { describeProvider, type MessagingBackend, type ProviderEntry } from '@kernl/messaging';
  import type { BootMode, ShellKernl } from './contract';
  import { abbreviate } from './contract';
  import Overlay from './Overlay.svelte';
  import { messagingError as explain, unavailableWhy } from './messaging-reasons';
  import { PREVIEW_CORRESPONDENT } from './preview-messaging';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
    onclose: () => void;
    onunread: (count: number) => void;
  }

  const { kernl, mode, onclose, onunread }: Props = $props();
  const backend: MessagingBackend = kernl.messaging.composite();

  let providers = $state.raw<readonly ProviderEntry[]>(kernl.messaging.list());
  let conversations = $state.raw<readonly DmConversation[]>([]);
  let selected = $state<string | null>(null);
  let thread = $state.raw<readonly DmMessage[]>([]);
  let draft = $state('');
  let recipient = $state(mode === 'preview' ? PREVIEW_CORRESPONDENT : '');
  let newProvider = $state(kernl.messaging.preferences().defaultProvider ?? '');
  let error = $state<string | null>(null);
  let owner = $state<string | undefined>(undefined);

  const enabled = $derived(providers.filter((entry) => entry.enabled));
  const preferences = $derived.by(() => {
    void providers;
    return kernl.messaging.preferences();
  });
  const providerOf = (id: string): string => providers.find((entry) => entry.provider.id === id.split(':')[0])?.provider.name ?? id.split(':')[0] ?? '';
  const nameOf = (conversation: DmConversation): string => conversation.participants.map((peer) => peer.label ?? abbreviate(peer.pubkey)).join(', ');
  const timeOf = (seconds: number): string => new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  async function refresh(): Promise<void> {
    const page = await backend.conversations({ limit: 50 });
    conversations = page.conversations;
    onunread(conversations.reduce((sum, conversation) => sum + conversation.unread, 0));
    if (selected) thread = (await backend.messages({ conversationId: selected, limit: 100 })).messages;
  }

  async function select(id: string): Promise<void> {
    selected = id;
    error = null;
    thread = (await backend.messages({ conversationId: id, limit: 100 })).messages;
  }

  async function send(): Promise<void> {
    const content = draft.trim();
    if (!content) return;
    error = null;
    try {
      const target = selected ? { conversationId: selected } : { provider: newProvider || undefined };
      const result = await backend.send({ ...target, recipients: selected ? [] : [recipient.trim()], content });
      draft = '';
      if (!selected) await select(result.message.conversationId);
      await refresh();
    } catch (reason) {
      error = explain(reason);
    }
  }

  function setEnabled(id: string, on: boolean): void {
    error = null;
    try {
      if (on) kernl.messaging.enable(id);
      else kernl.messaging.disable(id);
    } catch (reason) {
      error = explain(reason);
    }
    providers = kernl.messaging.list();
    void refresh();
  }

  function setDefault(id: string): void {
    kernl.messaging.setDefault(id);
    providers = kernl.messaging.list();
    newProvider = id;
  }

  $effect(() => {
    let subscriptionId: string | undefined;
    void (async () => {
      owner = (await backend.status()).ownerPubkey;
      await refresh();
      const subscription = await backend.subscribe({}, () => void refresh());
      subscriptionId = subscription.subscriptionId;
    })();
    return () => {
      if (subscriptionId) void backend.unsubscribe(subscriptionId);
    };
  });
</script>

<Overlay title="Messages" {onclose} wide>
  <div class="columns">
    <section class="shell-section providers">
      <h3>Providers</h3>
      <p class="shell-muted small">Each provider states what it protects. None is recommended over another; your correspondent decides what they can read.</p>
      <ul class="shell-list">
        {#each providers as entry (entry.provider.id)}
          <li class="shell-card">
            <div class="head">
              <h4>{entry.provider.name}</h4>
              {#if entry.enabled}
                <span class="shell-badge on">{preferences.defaultProvider === entry.provider.id ? 'default' : 'on'}</span>
              {:else if !entry.availability.available}
                <span class="shell-badge warn">not available</span>
              {/if}
            </div>
            <p>{entry.provider.description}</p>
            {#if !entry.availability.available}
              <p class="reason">{unavailableWhy(entry.availability.reason)}</p>
            {/if}
            <dl class="shell-rows">
              {#each describeProvider(entry.provider) as row (row.label)}
                <div><dt>{row.label}</dt><dd>{row.value}</dd></div>
              {/each}
            </dl>
            <div class="shell-actions">
              {#if entry.enabled}
                <button type="button" class="shell-button" onclick={() => setEnabled(entry.provider.id, false)}>Disable</button>
                {#if preferences.defaultProvider !== entry.provider.id}
                  <button type="button" class="shell-button quiet" onclick={() => setDefault(entry.provider.id)}>Make default</button>
                {/if}
              {:else}
                <button type="button" class="shell-button" disabled={!entry.availability.available} onclick={() => setEnabled(entry.provider.id, true)}>Enable</button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </section>
    <section class="shell-section talk">
      <h3>Conversations</h3>
      {#if conversations.length}
        <ul class="shell-list threads" role="listbox" aria-label="Conversations">
          {#each conversations as conversation (conversation.id)}
            <li>
              <button type="button" class="thread" class:active={selected === conversation.id} role="option" aria-selected={selected === conversation.id} onclick={() => select(conversation.id)}>
                <span class="name">{nameOf(conversation)}</span>
                <span class="shell-badge">{providerOf(conversation.id)}</span>
                {#if conversation.unread}<span class="unread">{conversation.unread}</span>{/if}
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="shell-muted small">No conversations yet.</p>
      {/if}
      {#if selected}
        <ol class="messages" aria-live="polite">
          {#each thread as message (message.id)}
            <li class:mine={message.senderPubkey === owner}>
              <span class="content">{message.content}</span>
              <time datetime={new Date(message.createdAt * 1000).toISOString()}>{timeOf(message.createdAt)}</time>
            </li>
          {/each}
        </ol>
        <button type="button" class="shell-button quiet" onclick={() => (selected = null)}>New conversation</button>
      {:else}
        <div class="new">
          <label class="shell-field">
            <span>To (account id)</span>
            <input class="shell-input mono" type="text" bind:value={recipient} autocomplete="off" spellcheck="false" />
          </label>
          <label class="shell-field">
            <span>Provider</span>
            <select class="shell-select" bind:value={newProvider}>
              {#each enabled as entry (entry.provider.id)}
                <option value={entry.provider.id}>{entry.provider.name}</option>
              {/each}
            </select>
          </label>
        </div>
      {/if}
      <form class="compose" onsubmit={(event) => (event.preventDefault(), send())}>
        <label class="shell-field">
          <span>Message</span>
          <textarea class="shell-textarea" bind:value={draft} rows="2" placeholder="Write a message"></textarea>
        </label>
        {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
        <div class="shell-actions">
          <button type="submit" class="shell-button primary" disabled={!draft.trim() || enabled.length === 0 || (!selected && !recipient.trim())}>Send</button>
        </div>
      </form>
    </section>
  </div>
</Overlay>

<style>
  .columns {
    display: grid;
    gap: 1.5rem;
    align-items: start;
  }

  /* Without this the sections stretch to the taller column and spread their rows apart. */
  .columns > .shell-section {
    align-content: start;
    margin-top: 0;
  }

  @media (min-width: 760px) {
    .columns {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    }
  }

  .small {
    font-size: 0.85rem;
    margin: 0;
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }

  .reason {
    font-size: 0.85rem;
    color: var(--ink-muted);
  }

  .threads {
    gap: 0.25rem;
  }

  .thread {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font: inherit;
    font-size: 0.9rem;
    text-align: left;
    color: var(--ink);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
  }

  .thread.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .name {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .unread {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 999px;
    padding: 0.1rem 0.45rem;
  }

  .messages {
    list-style: none;
    margin: 0;
    padding: 0.75rem;
    display: grid;
    gap: 0.4rem;
    max-height: 18rem;
    overflow: auto;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 12px;
  }

  .messages li {
    max-width: 85%;
    justify-self: start;
    display: grid;
    gap: 0.1rem;
    padding: 0.45rem 0.7rem;
    border-radius: 10px;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    font-size: 0.92rem;
  }

  .messages li.mine {
    justify-self: end;
    background: var(--accent-soft);
    border-color: transparent;
  }

  time {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    color: var(--ink-muted);
  }

  .new,
  .compose {
    display: grid;
    gap: 0.75rem;
  }
</style>
