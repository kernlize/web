<script lang="ts">
  import type { DownloadJob } from '@kernlize/bridges';
  import type { ShellKernl } from './contract';
  import { describeDownload } from './download-words';
  import type { ShellDownloads } from './downloads';
  import Overlay from './Overlay.svelte';

  interface Props {
    kernl: ShellKernl;
    downloads: ShellDownloads;
    onclose: () => void;
    onsettings: () => void;
  }

  const { kernl, downloads, onclose, onsettings }: Props = $props();

  let jobs = $state.raw<readonly DownloadJob[]>([]);
  let link = $state('');
  let error = $state<string | null>(null);
  const inKernl = $derived(downloads.mode() === 'kernl');

  $effect(() => downloads.engine.subscribe((next) => (jobs = next)));

  async function add(): Promise<void> {
    error = null;
    try {
      await kernl.bridges.resolve(link.trim(), { requester: 'shell' });
      link = '';
    } catch (reason) {
      const words = reason instanceof Error ? reason.message : '';
      error = words.startsWith('invalid:') || words.startsWith('denied:') ? 'That is not a download link kernl can open.' : 'The download could not start.';
    }
  }

  async function save(job: DownloadJob): Promise<void> {
    for (const file of await downloads.engine.files(job.id)) {
      const url = URL.createObjectURL(file.blob);
      const anchor = Object.assign(document.createElement('a'), { href: url, download: file.name });
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
</script>

<Overlay title="Downloads" {onclose}>
  <section class="shell-section">
    <p class="shell-muted small">
      {#if inKernl}
        Files shared by peers download here, inside kernl. Peers see your network address and what you fetch.
      {:else}
        Download links open in an app on your device.
      {/if}
      <button type="button" class="shell-button quiet inline" onclick={onsettings}>Change in Settings</button>
    </p>
    <form class="add" onsubmit={(event) => (event.preventDefault(), void add())}>
      <label class="shell-field"><span>Download link</span><input class="shell-input mono" type="text" inputmode="url" autocomplete="off" spellcheck="false" bind:value={link} placeholder="Paste a download link" /></label>
      <button type="submit" class="shell-button" disabled={!link.trim()}>Download</button>
    </form>
    {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
  </section>
  <section class="shell-section">
    <h3>In kernl</h3>
    <ul class="shell-list" aria-label="Downloads" data-testid="downloads">
      {#each jobs as job (job.id)}
        <li class="shell-card job" data-state={job.state}>
          <h4>{job.name}</h4>
          <progress max="1" value={job.progress} aria-label="{job.name}: {Math.round(job.progress * 100)}%"></progress>
          <p class="status">{describeDownload(job)}</p>
          <div class="shell-actions">
            {#if job.state === 'done'}
              <button type="button" class="shell-button primary" onclick={() => void save(job)}>Save</button>
            {:else if job.state === 'paused'}
              <button type="button" class="shell-button" onclick={() => downloads.engine.resume(job.id)}>Resume</button>
            {:else if job.state !== 'failed'}
              <button type="button" class="shell-button" onclick={() => downloads.engine.pause(job.id)}>Pause</button>
            {/if}
            <button type="button" class="shell-button quiet" onclick={() => downloads.engine.remove(job.id)} aria-label="Remove {job.name}">Remove</button>
          </div>
        </li>
      {:else}
        <li class="shell-muted">Nothing downloading.</li>
      {/each}
    </ul>
  </section>
</Overlay>

<style>
  .small {
    font-size: 0.85rem;
    margin: 0 0 0.75rem;
  }

  .inline {
    padding: 0 0.25rem;
  }

  .add {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: 0.5rem;
  }

  .job progress {
    width: 100%;
    accent-color: var(--accent);
  }

  .status {
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
</style>
