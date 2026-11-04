<script lang="ts">
  // The shell's version is the core's: apps/web is a private workspace that stays at 0.0.0.
  import core from '../../../../packages/core/package.json';
  import { bridgeName, bridgeRows } from './bridge-names';
  import type { BootMode, RelayTier, ShellKernl } from './contract';
  import type { DownloadMode, ShellDownloads } from './downloads';
  import { toggleTheme } from '../lib/theme';
  import { observe } from './observe.svelte';
  import Overlay from './Overlay.svelte';
  import { serverAddress, serverLabel } from './servers';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
    downloads: ShellDownloads;
    onclose: () => void;
  }

  const { kernl, mode, downloads, onclose }: Props = $props();
  let downloadMode = $state<DownloadMode>(downloads.mode());

  const DOWNLOAD_CHOICES: readonly { id: DownloadMode; label: string; help: string }[] = [
    { id: 'kernl', label: 'Download in kernl', help: 'Files shared by peers download inside this page. Peers see your network address and what you fetch.' },
    { id: 'device', label: 'Open in an app on your device', help: 'kernl asks first, then hands the link to the app your device uses for downloads.' },
  ];

  function chooseDownloads(next: DownloadMode): void {
    downloads.setMode(next);
    downloadMode = downloads.mode();
  }
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
    <h3>Downloads</h3>
    <fieldset class="choices">
      <legend class="shell-muted small">Where links to files shared by peers go.</legend>
      {#each DOWNLOAD_CHOICES as choice (choice.id)}
        {@const unavailable = choice.id === 'kernl' && !downloads.inKernl}
        <label class="shell-card choice" class:active={downloadMode === choice.id}>
          <input type="radio" name="download-mode" value={choice.id} checked={downloadMode === choice.id} disabled={unavailable} onchange={() => chooseDownloads(choice.id)} />
          <span class="name">{choice.label}{choice.id === 'kernl' && downloads.inKernl ? ' (default)' : ''}</span>
          <small>{unavailable ? 'This browser cannot connect to peers.' : choice.help}</small>
        </label>
      {/each}
    </fieldset>
  </section>
  <section class="shell-section">
    <h3>Bridges</h3>
    <p class="shell-muted small">Shell-owned services that fetch things from other networks for you. Each one says what the other side learns.</p>
    {#key downloadMode}
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
    {/key}
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
      <div><dt>Source</dt><dd>Private during alpha. <a href="https://kernl.run/docs/decisions">Decisions</a> are public.</dd></div>
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

  .choices {
    display: grid;
    gap: 0.5rem;
    border: 0;
    padding: 0;
    margin: 0;
  }

  .choice {
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.6rem;
    align-items: center;
    cursor: pointer;
  }

  .choice.active {
    border-color: var(--accent);
  }

  .choice small {
    grid-column: 2;
    color: var(--ink-muted);
    font-size: 0.8rem;
  }

  .add {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: 0.5rem;
  }
</style>
