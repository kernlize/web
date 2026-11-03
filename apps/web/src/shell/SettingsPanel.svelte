<script lang="ts">
  // The shell's version is the core's: apps/web is a private workspace that stays at 0.0.0.
  import core from '../../../../packages/core/package.json';
  import { bridgeName, bridgeRows } from './bridge-names';
  import type { BootMode, RelayTier, ShellKernl } from './contract';
  import { toggleTheme } from '../lib/theme';
  import { observe } from './observe.svelte';
  import Overlay from './Overlay.svelte';
  import { serverAddress, serverLabel } from './servers';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
    onclose: () => void;
  }

  const { kernl, mode, onclose }: Props = $props();
  const tiers = observe(kernl.relays.changes$, kernl.relays.get());
  $effect(() => tiers.stop);

  const TIERS: readonly { id: RelayTier; label: string; help: string }[] = [
    { id: 'discovery', label: 'Discovery', help: 'Where the shell looks up people and their preferences.' },
    { id: 'apps', label: 'Applet catalogue', help: 'Where applets are published and verified from.' },
    { id: 'outbox', label: 'Your connections', help: 'Where what you publish is delivered.' },
    { id: 'super', label: 'General', help: 'Used when nothing more specific applies.' },
  ];

  let drafts = $state<Record<RelayTier, string>>({ discovery: '', apps: '', outbox: '', super: '' });
  let error = $state<string | null>(null);

  function add(tier: RelayTier): void {
    error = null;
    try {
      kernl.relays.add(tier, serverAddress(drafts[tier]));
      drafts[tier] = '';
    } catch (reason) {
      error = reason instanceof Error && reason.message.startsWith('invalid:') ? 'Enter a server address such as server.example.' : 'That server could not be added.';
    }
  }
</script>

<Overlay title="Settings" {onclose} wide>
  <section class="shell-section">
    <h3>Network</h3>
    <p class="shell-muted small">Four tiers, each with its own servers. The shell connects to these on your behalf; applets never do.</p>
    <div class="tiers">
      {#each TIERS as tier (tier.id)}
        <div class="shell-card tier">
          <h4>{tier.label}</h4>
          <p>{tier.help}</p>
          <ul class="shell-list urls">
            {#each tiers.value[tier.id] as url, index (url)}
              {@const name = serverLabel(url, tier.label, index)}
              <li data-address={url}><span class="server">{name}</span><button type="button" class="shell-button quiet" onclick={() => kernl.relays.remove(tier.id, url)} aria-label="Remove {name} from {tier.label}">Remove</button></li>
            {:else}
              <li class="shell-muted">None configured.</li>
            {/each}
          </ul>
          <form class="add" onsubmit={(event) => (event.preventDefault(), add(tier.id))}>
            <label class="shell-field"><span>Server address</span><input class="shell-input mono" type="text" inputmode="url" autocomplete="off" spellcheck="false" bind:value={drafts[tier.id]} placeholder="server.example" /></label>
            <button type="submit" class="shell-button" disabled={!drafts[tier.id].trim()}>Add</button>
          </form>
        </div>
      {/each}
    </div>
    {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
  </section>
  <section class="shell-section">
    <h3>Bridges</h3>
    <p class="shell-muted small">Shell-owned services that fetch things from other networks for you. Each one says what the other side learns.</p>
    <ul class="shell-list bridges">
      {#each kernl.bridges.list() as bridge (bridge.id)}
        <li class="shell-card">
          <h4>{bridgeName(bridge)}</h4>
          <dl class="shell-rows">
            {#each bridgeRows(bridge) as row (row.label)}
              <div><dt>{row.label}</dt><dd>{row.value}</dd></div>
            {/each}
          </dl>
        </li>
      {/each}
    </ul>
  </section>
  <section class="shell-section">
    <h3>Appearance</h3>
    <button type="button" class="shell-button" onclick={toggleTheme}>Switch between light and dark</button>
  </section>
  <section class="shell-section">
    <h3>About</h3>
    <dl class="shell-rows">
      <div><dt>Shell</dt><dd>kernl {core.version}</dd></div>
      <div><dt>Mode</dt><dd>{mode === 'preview' ? 'preview, offline' : 'live'}</dd></div>
      <div><dt>Source</dt><dd>Private during alpha. <a href="https://kernlize.github.io/docs/decisions">Decisions</a> are public.</dd></div>
    </dl>
  </section>
</Overlay>

<style>
  .small {
    font-size: 0.85rem;
    margin: 0;
  }

  .tiers,
  .bridges {
    display: grid;
    gap: 0.75rem;
  }

  @media (min-width: 760px) {
    .tiers,
    .bridges {
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
</style>
