<script lang="ts">
  import type { BootMode, Session } from './contract';
  import type { WindowStore } from './window-store.svelte';

  interface Props {
    windows: WindowStore;
    session: Session;
    mode: BootMode;
    profile: string;
    guardEvents: number;
    unread: number;
    onlauncher: () => void;
    onpanel: (kind: 'guard' | 'messages' | 'settings' | 'downloads') => void;
    onsignout: () => void;
  }

  const { windows, session, mode, profile, guardEvents, unread, onlauncher, onpanel, onsignout }: Props = $props();

  /** Below this width the bar keeps the launcher and moves everything else into one menu. */
  const COMPACT_QUERY = '(max-width: 720px)';

  let compact = $state(false);
  let menuOpen = $state(false);
  let accountOpen = $state(false);
  const minimised = $derived(windows.windows.filter((win) => win.minimised));
  const otherLayout = $derived(windows.layout === 'floating' ? 'tiled' : 'floating');
  const windowCount = $derived(`${windows.windows.length} ${windows.windows.length === 1 ? 'window' : 'windows'}`);

  $effect(() => {
    const query = matchMedia(COMPACT_QUERY);
    const update = (): void => {
      compact = query.matches;
      if (!compact) menuOpen = false;
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });

  function choose(action: () => void): void {
    menuOpen = false;
    accountOpen = false;
    action();
  }
</script>

{#snippet guardButton()}
  <button type="button" class="shell-button quiet" onclick={() => choose(() => onpanel('guard'))} aria-label="Guard: {profile}, {guardEvents} events">Guard · {profile} · {guardEvents}</button>
{/snippet}
{#snippet messagesButton()}
  <button type="button" class="shell-button quiet" onclick={() => choose(() => onpanel('messages'))} aria-label="Messages, {unread} unread">Messages{#if unread} <span class="count">{unread}</span>{/if}</button>
{/snippet}
{#snippet downloadsButton()}
  <button type="button" class="shell-button quiet" onclick={() => choose(() => onpanel('downloads'))}>Downloads</button>
{/snippet}
{#snippet dock()}
  {#if minimised.length}
    <ul class="dock" aria-label="Minimised windows">
      {#each minimised as win (win.id)}
        <li><button type="button" class="shell-button quiet" onclick={() => choose(() => windows.focus(win.id))}>{win.plan.summary.title}</button></li>
      {/each}
    </ul>
  {/if}
{/snippet}

<header class="status-bar" class:compact tabindex="-1">
  <span class="wordmark" aria-hidden="true">kernl</span>
  <button type="button" class="shell-button primary" onclick={onlauncher} aria-keyshortcuts="Alt+/" aria-label="Open an applet">{compact ? 'Open' : 'Open an applet'}</button>
  {#if compact}
    <span class="spacer"></span>
    {#if mode === 'preview'}<span class="shell-badge warn">preview</span>{/if}
    <button type="button" class="shell-button quiet" aria-expanded={menuOpen} aria-controls="shell-menu" onclick={() => (menuOpen = !menuOpen)}>Menu{#if unread} <span class="count">{unread}</span>{/if}</button>
    {#if menuOpen}
      <nav id="shell-menu" class="sheet" aria-label="Shell menu">
        <p class="shell-muted who">{session.label}{#if session.readOnly} · read-only{/if}</p>
        {@render guardButton()}
        {@render messagesButton()}
        {@render downloadsButton()}
        <button type="button" class="shell-button quiet" onclick={() => choose(() => windows.setLayout(otherLayout))}>Layout: {windows.layout} · {windowCount}</button>
        {@render dock()}
        <button type="button" class="shell-button quiet" onclick={() => choose(() => onpanel('settings'))}>Settings</button>
        <button type="button" class="shell-button quiet" onclick={() => choose(onsignout)}>Sign out</button>
      </nav>
    {/if}
  {:else}
    <div class="workspace" aria-label="Workspace">
      <span class="shell-muted">Workspace 1 · {windowCount}</span>
      <button type="button" class="shell-button quiet" onclick={() => windows.setLayout(otherLayout)} aria-label="Layout: {windows.layout}. Switch to {otherLayout}">{windows.layout}</button>
      {@render dock()}
    </div>
    <div class="right">
      {#if mode === 'preview'}<span class="shell-badge warn" title="Nothing here reaches the network">preview</span>{/if}
      {@render guardButton()}
      {@render messagesButton()}
      {@render downloadsButton()}
      <details class="account" bind:open={accountOpen}>
        <summary class="shell-button quiet">{session.label}{#if session.readOnly} <span class="shell-badge">read-only</span>{/if}</summary>
        <div class="menu">
          <button type="button" class="shell-button quiet" onclick={() => choose(() => onpanel('settings'))}>Settings</button>
          <button type="button" class="shell-button quiet" onclick={() => choose(onsignout)}>Sign out</button>
        </div>
      </details>
    </div>
  {/if}
</header>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0.75rem;
    min-height: 3rem;
    min-width: 0;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    border-bottom: 1px solid var(--line);
    z-index: 300;
    position: relative;
  }

  .status-bar.compact {
    gap: 0.5rem;
  }

  .wordmark {
    font-family: var(--font-mono);
    font-weight: 500;
    letter-spacing: -0.02em;
  }

  .shell-button {
    white-space: nowrap;
  }

  .spacer {
    flex: 1;
  }

  .workspace {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.78rem;
    min-width: 0;
    flex: 1;
  }

  .dock {
    list-style: none;
    margin: 0;
    padding: 0 0 0 0.5rem;
    display: flex;
    gap: 0.25rem;
    border-left: 1px solid var(--line);
    overflow-x: auto;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .count {
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 999px;
    padding: 0 0.4rem;
    font-size: 0.7rem;
  }

  .account {
    position: relative;
  }

  .account summary {
    list-style: none;
  }

  .account summary::-webkit-details-marker {
    display: none;
  }

  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 0.25rem);
    display: grid;
    gap: 0.1rem;
    min-width: 10rem;
    padding: 0.3rem;
    background: var(--bg-raised);
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
  }

  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    top: 100%;
    display: grid;
    gap: 0.15rem;
    padding: 0.5rem 0.75rem 0.75rem;
    max-height: calc(100dvh - 3rem);
    overflow: auto;
    background: var(--bg-raised);
    border-bottom: 1px solid var(--line-strong);
    box-shadow: 0 16px 30px rgba(0, 0, 0, 0.3);
  }

  .sheet .dock {
    flex-wrap: wrap;
    border-left: 0;
    padding: 0;
  }

  .who {
    margin: 0 0 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.78rem;
  }

  .menu .shell-button,
  .sheet .shell-button {
    justify-content: flex-start;
  }
</style>
