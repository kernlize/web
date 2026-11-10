<script lang="ts">
  import type { FileServerState } from '@kernlize/core';
  import type { ShellKernl } from './contract';
  import { observe } from './observe.svelte';
  import { serverLabel } from './servers';

  interface Props {
    kernl: ShellKernl;
  }

  const { kernl }: Props = $props();

  const published = observe<FileServerState>(kernl.files.state$, kernl.files.state());
  $effect(() => published.stop);
  const session = observe(kernl.session$, kernl.session);
  $effect(() => session.stop);

  let edited = $state.raw<readonly string[] | undefined>(undefined);
  let typed = $state('');
  let error = $state<string | null>(null);
  let saved = $state<string | null>(null);
  let saving = $state(false);

  const current = $derived(edited ?? (published.value.status === 'loading' ? undefined : published.value.servers));
  const readOnly = $derived(session.value?.readOnly !== false);
  // A name that would say the protocol's name is replaced by the list's own (D-006).
  const nameOf = (url: string, index: number): string => serverLabel(new URL(url).hostname, 'File', index);

  function add(): void {
    error = null;
    saved = null;
    const input = typed.trim();
    let url: string;
    try {
      url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`).origin + '/';
    } catch {
      error = 'Enter a file server address such as blossom.primal.net.';
      return;
    }
    if (!url.includes('.')) {
      error = 'Enter a file server address such as blossom.primal.net.';
      return;
    }
    edited = [...new Set([...(current ?? []), url])];
    typed = '';
  }

  function remove(url: string): void {
    saved = null;
    edited = (current ?? []).filter((entry) => entry !== url);
  }

  async function save(): Promise<void> {
    if (!current) return;
    saving = true;
    error = null;
    try {
      const { describeOutcome } = await import('@kernlize/core');
      const outcome = await kernl.files.save(current);
      saved = describeOutcome(outcome);
      if (outcome.ok) edited = undefined;
    } catch {
      error = 'The list could not be signed. Check that your signer is open, then try again.';
    } finally {
      saving = false;
    }
  }
</script>

<section class="shell-section" aria-labelledby="file-servers-heading">
  <h3 id="file-servers-heading">File servers</h3>
  <p class="shell-muted small">Where pictures and files you upload through an applet are kept. The first gets each file and the others keep copies. You are asked before every upload.</p>
  {#if !current}
    <p class="shell-muted" role="status">Looking for your file servers…</p>
  {:else}
    {#if published.value.status === 'missing' && !edited}<p class="small" role="status">This account has not chosen file servers yet, so these well-known ones are used.</p>{/if}
    <ul class="shell-list urls" aria-label="File servers">
      {#each current as url, index (url)}
        {@const name = nameOf(url, index)}
        <li data-address={url}>
          <span class="server">{name}{index === 0 ? ' (first)' : ''}</span>
          {#if !readOnly}<button type="button" class="shell-button quiet" onclick={() => remove(url)} aria-label="Remove {name} from file servers">Remove</button>{/if}
        </li>
      {:else}
        <li class="shell-muted">None. Uploads are refused until you add one.</li>
      {/each}
    </ul>
    {#if !readOnly}
      <form class="add" onsubmit={(event) => (event.preventDefault(), add())}>
        <label class="shell-field"><span>Add a file server</span><input class="shell-input mono" type="text" inputmode="url" autocomplete="off" spellcheck="false" bind:value={typed} placeholder="blossom.primal.net" /></label>
        <button type="submit" class="shell-button" disabled={!typed.trim()}>Add</button>
      </form>
      <div class="shell-actions">
        <button type="button" class="shell-button primary" onclick={save} disabled={saving || edited === undefined}>{saving ? 'Publishing…' : 'Publish file servers'}</button>
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

  .urls li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    max-width: none;
  }

  .add {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: 0.5rem;
  }
</style>
