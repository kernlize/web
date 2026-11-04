<script lang="ts">
  import { untrack } from 'svelte';
  import type { Booted, MountPlan, Session, StorageLike } from './contract';
  import GrantsPanel from './GrantsPanel.svelte';
  import type { GuardLog } from './guard-log.svelte';
  import GuardPanel from './GuardPanel.svelte';
  import IframeLayer from './IframeLayer.svelte';
  import DownloadsPanel from './DownloadsPanel.svelte';
  import Launcher from './Launcher.svelte';
  import MessagesPanel from './MessagesPanel.svelte';
  import { observe } from './observe.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import StatusBar from './StatusBar.svelte';
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

  type Overlay = { kind: 'launcher'; address?: string } | { kind: 'grants'; windowId: string } | { kind: 'guard' } | { kind: 'messages' } | { kind: 'settings' } | { kind: 'downloads' };

  let overlay = $state.raw<Overlay | null>(null);
  let unread = $state(0);
  let desk = $state<HTMLElement | null>(null);
  const profile = observe(kernl.guard.profile$, kernl.guard.config.profile);
  $effect(() => profile.stop);

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
    // setArea reads and rewrites every window's rect. Run untracked, or this effect would
    // depend on the rects it writes and re-run without end once a window is open.
    const measure = (): void => {
      const box = element.getBoundingClientRect();
      untrack(() => windows.setArea({ x: 0, y: 0, width: Math.floor(box.width), height: Math.floor(box.height) }));
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
  <StatusBar {windows} {session} mode={booted.mode} profile={profile.value} guardEvents={guardLog.total} {unread} onlauncher={() => openLauncher()} onpanel={open} {onsignout} />

  <div class="desk" bind:this={desk} role="presentation">
    <div class="wallpaper" onpointerdown={() => windows.blur()}></div>
    <WindowLayer {windows} ongrants={(windowId) => (overlay = { kind: 'grants', windowId })} />
    <IframeLayer {kernl} {windows} />

    {#if windows.windows.length === 0}
      <div class="empty">
        <p class="shell-muted">No applets open.{' '}<span class="with-keyboard">Press <kbd>Alt</kbd> + <kbd>/</kbd> or use the button above.</span><span class="touch">Use the button above.</span></p>
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
      <SettingsPanel {kernl} mode={booted.mode} downloads={booted.downloads} onclose={() => (overlay = null)} />
    {:else if overlay?.kind === 'downloads'}
      <DownloadsPanel {kernl} downloads={booted.downloads} onclose={() => (overlay = null)} onsettings={() => open('settings')} />
    {/if}
  </div>
</div>

<style>
  .desktop {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr;
    grid-template-columns: minmax(0, 1fr);
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
    padding: 0 1rem;
    text-align: center;
  }

  .touch {
    display: none;
  }

  @media (max-width: 720px) {
    .with-keyboard {
      display: none;
    }

    .touch {
      display: inline;
    }
  }

  kbd {
    font-family: var(--font-mono);
    font-size: 0.8em;
    border: 1px solid var(--line-strong);
    border-radius: 5px;
    padding: 0.05rem 0.35rem;
  }

</style>
