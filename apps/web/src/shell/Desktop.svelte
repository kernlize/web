<script lang="ts">
  import type { Booted, MountPlan, Session, StorageLike } from './contract';
  import GrantsPanel from './GrantsPanel.svelte';
  import type { GuardLog } from './guard-log.svelte';
  import GuardPanel from './GuardPanel.svelte';
  import IframeLayer from './IframeLayer.svelte';
  import Launcher from './Launcher.svelte';
  import MessagesPanel from './MessagesPanel.svelte';
  import { observe } from './observe.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import WindowLayer from './WindowLayer.svelte';
  import type { WindowStore } from './window-store.svelte';

  interface Props {
    booted: Booted;
    session: Session;
    storage: StorageLike;
    windows: WindowStore;
    guardLog: GuardLog;
    onsignout: () => void;
  }

  const { booted, session, storage, windows, guardLog, onsignout }: Props = $props();
  const kernl = $derived(booted.kernl);

  type Overlay = { kind: 'launcher'; address?: string } | { kind: 'grants'; windowId: string } | { kind: 'guard' } | { kind: 'messages' } | { kind: 'settings' };

  let overlay = $state.raw<Overlay | null>(null);
  let unread = $state(0);
  let desk = $state<HTMLElement | null>(null);
  const profile = observe(kernl.guard.profile$, kernl.guard.config.profile);
  $effect(() => profile.stop);

  const minimised = $derived(windows.windows.filter((win) => win.minimised));
  const grantsWindow = $derived(overlay?.kind === 'grants' ? windows.get(overlay.windowId) : undefined);

  export function openLauncher(address?: string): void {
    windows.blur();
    overlay = address === undefined ? { kind: 'launcher' } : { kind: 'launcher', address };
  }

  /** Close the top-most overlay; false when nothing was open. */
  export function closeTopOverlay(): boolean {
    if (!overlay) return false;
    overlay = null;
    return true;
  }

  function open(kind: Exclude<Overlay, { kind: 'launcher' | 'grants' }>['kind']): void {
    windows.blur();
    overlay = { kind };
  }

  function openPlan(plan: MountPlan): void {
    overlay = null;
    windows.open(plan);
  }

  $effect(() => {
    const element = desk;
    if (!element) return;
    const measure = (): void => {
      const box = element.getBoundingClientRect();
      windows.setArea({ x: 0, y: 0, width: Math.floor(box.width), height: Math.floor(box.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  });

  $effect(() => {
    const params = new URLSearchParams(location.search);
    const address = params.get('open');
    if (!address) return;
    params.delete('open');
    const query = params.toString();
    history.replaceState(null, '', `${location.pathname}${query ? `?${query}` : ''}`);
    openLauncher(address);
  });
</script>

<div class="desktop">
  <header class="status-bar" tabindex="-1">
    <span class="wordmark" aria-hidden="true">kernl</span>
    <button type="button" class="shell-button primary" onclick={() => openLauncher()} aria-keyshortcuts="Alt+/">Open an applet</button>
    <div class="workspace" aria-label="Workspace">
      <span class="shell-muted">Workspace 1 · {windows.windows.length} {windows.windows.length === 1 ? 'window' : 'windows'}</span>
      <button type="button" class="shell-button quiet" onclick={() => windows.setLayout(windows.layout === 'floating' ? 'tiled' : 'floating')} aria-label="Layout: {windows.layout}. Switch to {windows.layout === 'floating' ? 'tiled' : 'floating'}">{windows.layout}</button>
      {#if minimised.length}
        <ul class="dock" aria-label="Minimised windows">
          {#each minimised as win (win.id)}
            <li><button type="button" class="shell-button quiet" onclick={() => windows.focus(win.id)}>{win.plan.summary.title}</button></li>
          {/each}
        </ul>
      {/if}
    </div>
    <div class="right">
      {#if booted.mode === 'preview'}<span class="shell-badge warn" title="Nothing here reaches the network">preview</span>{/if}
      <button type="button" class="shell-button quiet" onclick={() => open('guard')} aria-label="Guard: {profile.value}, {guardLog.total} events">Guard · {profile.value} · {guardLog.total}</button>
      <button type="button" class="shell-button quiet" onclick={() => open('messages')} aria-label="Messages, {unread} unread">Messages{#if unread} <span class="count">{unread}</span>{/if}</button>
      <details class="account">
        <summary class="shell-button quiet">{session.label}{#if session.readOnly} <span class="shell-badge">read-only</span>{/if}</summary>
        <div class="menu">
          <button type="button" class="shell-button quiet" onclick={() => open('settings')}>Settings</button>
          <button type="button" class="shell-button quiet" onclick={onsignout}>Sign out</button>
        </div>
      </details>
    </div>
  </header>

  <div class="desk" bind:this={desk} role="presentation">
    <div class="wallpaper" onpointerdown={() => windows.blur()}></div>
    <WindowLayer {windows} ongrants={(windowId) => (overlay = { kind: 'grants', windowId })} />
    <IframeLayer {kernl} {windows} />

    {#if windows.windows.length === 0}
      <div class="empty">
        <p class="shell-muted">No applets open. Press <kbd>Alt</kbd> + <kbd>/</kbd> or use the button above.</p>
      </div>
    {/if}

    {#if overlay?.kind === 'launcher'}
      <Launcher {kernl} samples={booted.samples} {storage} initialAddress={overlay.address} onclose={() => (overlay = null)} onopen={openPlan} />
    {:else if overlay?.kind === 'grants' && grantsWindow}
      <GrantsPanel {kernl} win={grantsWindow} {guardLog} onclose={() => (overlay = null)} />
    {:else if overlay?.kind === 'guard'}
      <GuardPanel {kernl} {guardLog} {windows} onclose={() => (overlay = null)} />
    {:else if overlay?.kind === 'messages'}
      <MessagesPanel {kernl} mode={booted.mode} onclose={() => (overlay = null)} onunread={(count) => (unread = count)} />
    {:else if overlay?.kind === 'settings'}
      <SettingsPanel {kernl} mode={booted.mode} onclose={() => (overlay = null)} />
    {/if}
  </div>
</div>

<style>
  .desktop {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr;
  }

  .status-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0.75rem;
    min-height: 3rem;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    border-bottom: 1px solid var(--line);
    z-index: 100;
    position: relative;
  }

  .wordmark {
    font-family: var(--font-mono);
    font-weight: 500;
    letter-spacing: -0.02em;
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

  .menu .shell-button {
    justify-content: flex-start;
  }

  .desk {
    position: relative;
    overflow: hidden;
  }

  .wallpaper {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(60rem 30rem at 85% -10%, var(--accent-soft), transparent 60%),
      repeating-linear-gradient(0deg, transparent 0 39px, color-mix(in srgb, var(--line) 50%, transparent) 39px 40px),
      repeating-linear-gradient(90deg, transparent 0 39px, color-mix(in srgb, var(--line) 50%, transparent) 39px 40px),
      var(--bg);
  }

  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    font-size: 0.95rem;
  }

  kbd {
    font-family: var(--font-mono);
    font-size: 0.8em;
    border: 1px solid var(--line-strong);
    border-radius: 5px;
    padding: 0.05rem 0.35rem;
  }

  @media (max-width: 720px) {
    .workspace > .shell-muted {
      display: none;
    }
  }
</style>
