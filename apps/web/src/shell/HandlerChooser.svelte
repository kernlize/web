<script lang="ts">
  import type { AppletSummary, CatalogEntry, HandlerChoice, HandlerPrompt, ShellKernl } from './contract';
  import AppletReview from './AppletReview.svelte';
  import { explainOpenFailure } from './launcher-reasons';
  import Overlay from './Overlay.svelte';
  import StoreBrowser from './StoreBrowser.svelte';
  import { rememberWords, requestWords } from './store';

  interface Props {
    kernl: ShellKernl;
    prompt: HandlerPrompt;
    onanswer: (choice: HandlerChoice | undefined) => void;
  }

  const { kernl, prompt, onanswer }: Props = $props();

  // With nothing installed that can take the request, the store is the first thing shown.
  let view = $state<'options' | 'store'>(prompt.options.length ? 'options' : 'store');
  let selected = $state(prompt.options[0]?.id ?? '');
  let remember = $state(false);
  let summary = $state.raw<AppletSummary | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function review(address: string): Promise<void> {
    busy = true;
    error = null;
    try {
      summary = await kernl.resolve(kernl.decodePointer(address));
    } catch (reason) {
      error = explainOpenFailure(reason);
    } finally {
      busy = false;
    }
  }

  async function install(found: AppletSummary): Promise<void> {
    const applet = kernl.install(found);
    onanswer({ id: applet.catalogId, remember });
  }
</script>

<Overlay title="Choose an applet" wide onclose={() => onanswer(undefined)}>
  <div class="chooser">
    <p class="request">{requestWords(prompt)}</p>
    {#if error}<p class="shell-error" role="alert">{error}</p>{/if}

    {#if summary}
      {#key summary}
        <AppletReview {kernl} {summary} action="Use this applet" onback={() => (summary = null)} onconfirm={install} />
      {/key}
    {:else if view === 'options'}
      <fieldset class="options">
        <legend class="shell-muted">Which applet should do it?</legend>
        {#each prompt.options as option (option.id)}
          <label class="shell-card option">
            <input type="radio" name="handler" value={option.id} bind:group={selected} />
            <span>{option.title}</span>
            {#if option.preferred}<span class="shell-badge on">your pick</span>{/if}
          </label>
        {/each}
      </fieldset>
      <label class="shell-toggle">
        <span class="text"><span>{rememberWords(prompt)}</span><small>You can change this under Applets, Yours.</small></span>
        <input type="checkbox" bind:checked={remember} />
      </label>
      <div class="shell-actions">
        <button type="button" class="shell-button primary" disabled={!selected} onclick={() => onanswer({ id: selected, remember })}>Open with it</button>
        <button type="button" class="shell-button quiet" onclick={() => (view = 'store')}>Find another applet</button>
        <button type="button" class="shell-button quiet" onclick={() => onanswer(undefined)}>Cancel</button>
      </div>
    {:else}
      <p class="shell-muted">{prompt.options.length ? 'Applets in the store that can do it:' : 'None of your applets can do this yet. These in the store can:'}</p>
      {#if prompt.recommended}
        <div class="shell-card row">
          <p>{prompt.source} suggests an applet for this.</p>
          <button type="button" class="shell-button" disabled={busy} onclick={() => review(prompt.recommended ?? '')}>See it</button>
        </div>
      {/if}
      <label class="shell-toggle">
        <span class="text"><span>{rememberWords(prompt)}</span></span>
        <input type="checkbox" bind:checked={remember} />
      </label>
      <StoreBrowser {kernl} {busy} convention={prompt.convention} onpick={(entry: CatalogEntry) => review(entry.address)} onaddress={review} />
      <div class="shell-actions">
        {#if prompt.options.length}<button type="button" class="shell-button quiet" onclick={() => (view = 'options')}>Back to your applets</button>{/if}
        <button type="button" class="shell-button quiet" onclick={() => onanswer(undefined)}>Cancel</button>
      </div>
    {/if}
  </div>
</Overlay>

<style>
  .chooser {
    display: grid;
    gap: 0.9rem;
  }

  .request {
    margin: 0;
    font-size: 1.1rem;
  }

  .options {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.5rem;
  }

  .options legend {
    margin-bottom: 0.5rem;
  }

  .option {
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.75rem;
    cursor: pointer;
  }

  .row {
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  .row p {
    margin: 0;
  }
</style>
