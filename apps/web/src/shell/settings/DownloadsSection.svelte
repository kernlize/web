<script lang="ts">
  import { bridgeName, bridgeRows } from '../bridge-names';
  import type { BootMode, ShellKernl } from '../contract';
  import type { DownloadMode, ShellDownloads } from '../downloads';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
    downloads: ShellDownloads;
  }

  const { kernl, mode, downloads }: Props = $props();
  let downloadMode = $state<DownloadMode>(downloads.mode());

  const DOWNLOAD_CHOICES: readonly { id: DownloadMode; label: string; help: string }[] = [
    { id: 'kernl', label: 'Download in kernl', help: 'Files shared by peers download inside this page. Peers see your network address and what you fetch.' },
    { id: 'device', label: 'Open in an app on your device', help: 'kernl asks first, then hands the link to the app your device uses for downloads.' },
  ];

  function chooseDownloads(next: DownloadMode): void {
    downloads.setMode(next);
    downloadMode = downloads.mode();
  }
</script>

<section class="shell-section" aria-labelledby="download-links-heading">
  <h3 id="download-links-heading">Downloads</h3>
  {#if mode === 'preview'}<p class="shell-muted small">The preview makes its sample file in the page and reaches no peers.</p>{/if}
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
<section class="shell-section" aria-labelledby="bridges-heading">
  <h3 id="bridges-heading">Bridges</h3>
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

<style>
  .small {
    font-size: 0.85rem;
    margin: 0;
  }

  .bridges {
    display: grid;
    gap: 0.75rem;
  }

  .bridges li {
    max-width: none;
  }

  /* The window's own width, not the page's: Settings is resized and tiled on its own (D-049). */
  @container (min-width: 36rem) {
    .bridges {
      grid-template-columns: 1fr 1fr;
    }
  }

  .choices {
    display: grid;
    gap: 0.5rem;
    border: 0;
    padding: 0;
    margin: 0;
  }

  .choices legend {
    padding: 0;
    margin-bottom: 0.5rem;
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
</style>
