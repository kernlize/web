<script lang="ts">
  import type { MediaSettings } from '@kernlize/core';
  import type { BootMode, ShellKernl } from '../contract';
  import { mediaSettingGroups } from '../media-words';
  import { observe } from '../observe.svelte';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
  }

  const { kernl, mode }: Props = $props();
  const settings = observe(kernl.media.settings$, kernl.media.settings());
  $effect(() => settings.stop);
  const groups = $derived(mediaSettingGroups(settings.value));

  function choose(key: keyof MediaSettings, value: string): void {
    kernl.media.configure({ [key]: value } as Partial<MediaSettings>);
  }
</script>

<section class="shell-section" aria-labelledby="media-heading">
  <h3 id="media-heading">Media</h3>
  {#if mode === 'preview'}<p class="shell-muted small">The preview plays nothing.</p>{/if}
  {#each groups as group (group.key)}
    <fieldset class="choices">
      <legend>{group.label}</legend>
      {#each group.choices as choice, index (choice.id)}
        <label class="shell-card choice" class:active={settings.value[group.key] === choice.id}>
          <input type="radio" name="media-{group.key}" value={choice.id} checked={settings.value[group.key] === choice.id} onchange={() => choose(group.key, choice.id)} />
          <span>{choice.label}{index === 0 ? ' (default)' : ''}</span>
        </label>
      {/each}
    </fieldset>
  {/each}
</section>

<style>
  .small {
    font-size: 0.85rem;
    margin: 0 0 0.75rem;
  }

  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    border: 0;
    padding: 0;
    margin: 0 0 1rem;
  }

  .choices legend {
    padding: 0;
    margin-bottom: 0.4rem;
    font-size: 0.85rem;
    color: var(--ink-muted);
  }

  .choice {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
    max-width: none;
  }

  .choice.active {
    border-color: var(--accent);
  }

  @container (max-width: 26rem) {
    .choices {
      grid-template-columns: 1fr;
    }
  }
</style>
