<script lang="ts">
  import Publisher from './Publisher.svelte';
  import type { AppletSummary, BootMode, CatalogEntry, MountPlan, ShellKernl, StorageLike } from './contract';
  import AppletReview from './AppletReview.svelte';
  import InstalledApplets from './InstalledApplets.svelte';
  import { explainOpenFailure } from './launcher-reasons';
  import Overlay from './Overlay.svelte';
  import { forgetRecent, readRecent, rememberRecent, type RecentApplet } from './recent';
  import StoreBrowser from './StoreBrowser.svelte';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
    storage: StorageLike;
    initialAddress?: string;
    onclose: () => void;
    onopen: (plan: MountPlan) => void;
  }

  const { kernl, mode, storage, initialAddress = '', onclose, onopen }: Props = $props();

  type Tab = 'store' | 'installed' | 'recent';

  // The address the shell resolves stays in state; the search field is cleared once an applet is
  // found, so a raw address is never echoed back in the summary (D-006).
  let tab = $state<Tab>('store');
  let address = $state('');
  let summary = $state.raw<AppletSummary | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let recent = $state.raw<readonly RecentApplet[]>(readRecent(storage));

  async function resolve(target: string): Promise<void> {
    address = target.trim();
    error = null;
    busy = true;
    try {
      summary = await kernl.resolve(kernl.decodePointer(address));
    } catch (reason) {
      error = explainOpenFailure(reason);
    } finally {
      busy = false;
    }
  }

  async function run(found: AppletSummary): Promise<void> {
    const plan = await kernl.plan(found);
    recent = rememberRecent(storage, { address, title: found.title, publisher: found.publisher });
    onopen(plan);
  }

  $effect(() => {
    if (initialAddress) void resolve(initialAddress);
  });
</script>

<Overlay title="Applets" wide {onclose}>
  {#if summary}
    {#key summary}
      <AppletReview {kernl} {summary} action="Run" onback={() => (summary = null)} onconfirm={run} />
    {/key}
  {:else}
    <div class="tabs" role="tablist" aria-label="Applets">
      <button type="button" role="tab" aria-selected={tab === 'store'} class:on={tab === 'store'} onclick={() => (tab = 'store')}>Store</button>
      <button type="button" role="tab" aria-selected={tab === 'installed'} class:on={tab === 'installed'} onclick={() => (tab = 'installed')}>Yours</button>
      {#if recent.length}
        <button type="button" role="tab" aria-selected={tab === 'recent'} class:on={tab === 'recent'} onclick={() => (tab = 'recent')}>Recent</button>
      {/if}
    </div>
    {#if error}<p class="shell-error" role="alert">{error}</p>{/if}

    {#if tab === 'store'}
      {#if mode === 'preview'}<p class="shell-muted" role="note">The preview is offline, so the store shows its three sample applets. Sign in to the live shell to browse every published applet.</p>{/if}
      <StoreBrowser {kernl} {busy} onpick={(entry: CatalogEntry) => resolve(entry.address)} onaddress={resolve} />
    {:else if tab === 'installed'}
      <InstalledApplets {kernl} {mode} {busy} onopen={resolve} />
    {:else}
      <ul class="shell-list">
        {#each recent as entry (entry.address)}
          <li class="shell-card row">
            <div>
              <h4>{entry.title}</h4>
              <p class="shell-muted"><Publisher {kernl} applet={entry} /></p>
            </div>
            <div class="shell-actions">
              <button type="button" class="shell-button" onclick={() => resolve(entry.address)} disabled={busy}>Open</button>
              <button type="button" class="shell-button quiet" onclick={() => (recent = forgetRecent(storage, entry.address))} aria-label="Forget {entry.title}">Forget</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</Overlay>

<style>
  .tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--line);
    margin-bottom: 1rem;
  }

  .tabs button {
    font: inherit;
    background: transparent;
    color: var(--ink-muted);
    border: 0;
    border-bottom: 2px solid transparent;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
  }

  .tabs button.on {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .row {
    grid-template-columns: 1fr auto;
    align-items: center;
  }
</style>
