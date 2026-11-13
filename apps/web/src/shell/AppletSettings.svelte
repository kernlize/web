<script lang="ts">
  import type { SettingsPrompt } from './contract';
  import Overlay from './Overlay.svelte';
  import { commitSettings, draftOf, settingsSections } from './settings-form';

  interface Props {
    prompt: SettingsPrompt;
    onclose: () => void;
  }

  const { prompt, onclose }: Props = $props();
  const sections = $derived(settingsSections(prompt.context.schema, prompt.context.values));
  // The form is keyed by prompt in the shell, so the first values are the ones it edits.
  // svelte-ignore state_referenced_locally
  let draft = $state(draftOf(settingsSections(prompt.context.schema, prompt.context.values), prompt.context.values));
  let error = $state('');
  const fieldId = (key: string): string => `applet-setting-${key}`;

  /** The section the applet asked to open is scrolled into view once the form is drawn. */
  function reveal(node: HTMLElement, id: string | undefined): void {
    if (id !== undefined && id === prompt.section) node.scrollIntoView({ block: 'start' });
  }

  function save(): void {
    const outcome = commitSettings(prompt.context, sections, draft);
    if (outcome.ok) onclose();
    else error = outcome.error;
  }
</script>

<Overlay title="{prompt.title} settings" {onclose}>
  <form class="settings" novalidate onsubmit={(event) => (event.preventDefault(), save())}>
    {#if sections.length === 0}
      <p class="shell-muted">This applet has no settings the shell can show.</p>
    {/if}
    {#each sections as section (section.id ?? '')}
      <fieldset class="shell-section" data-section={section.id ?? ''} {@attach (node) => reveal(node, section.id)}>
        {#if sections.length > 1 || section.id !== undefined}<legend><h3>{section.heading}</h3></legend>{/if}
        {#each section.fields as field (field.key)}
          {#if field.kind === 'toggle'}
            <label class="shell-toggle">
              <span class="text">{field.label}{#if field.description}<small>{field.description}</small>{/if}</span>
              <input id={fieldId(field.key)} type="checkbox" bind:checked={draft[field.key] as boolean} />
            </label>
          {:else}
            <div class="shell-field">
              <label for={fieldId(field.key)}>{field.label}{field.required ? '' : ' (optional)'}</label>
              {#if field.kind === 'choice'}
                <select id={fieldId(field.key)} class="shell-select" bind:value={draft[field.key]}>
                  {#if !field.required || draft[field.key] === ''}<option value="">Not set</option>{/if}
                  {#each field.choices ?? [] as choice (choice.value)}<option value={choice.value}>{choice.label}</option>{/each}
                </select>
              {:else if field.kind === 'number'}
                <input id={fieldId(field.key)} class="shell-input" type="number" inputmode="decimal" min={field.min} max={field.max} step={field.step} bind:value={draft[field.key]} />
              {:else if field.kind === 'secret'}
                <input id={fieldId(field.key)} class="shell-input mono" type="password" autocomplete="off" spellcheck="false" placeholder={field.kept ? 'Saved; leave empty to keep it' : ''} bind:value={draft[field.key] as string} />
              {:else}
                <input id={fieldId(field.key)} class="shell-input" type="text" autocomplete="off" bind:value={draft[field.key] as string} />
              {/if}
              {#if field.description}<small class="shell-muted">{field.description}</small>{/if}
            </div>
          {/if}
        {/each}
      </fieldset>
    {/each}
    {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
    <div class="shell-actions">
      <button type="submit" class="shell-button primary">Save</button>
      <button type="button" class="shell-button quiet" onclick={onclose}>Cancel</button>
    </div>
    <p class="shell-muted small">The shell keeps these settings and only this applet can read them.</p>
  </form>
</Overlay>

<style>
  .settings {
    display: grid;
    gap: 1rem;
  }

  fieldset {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }

  legend {
    padding: 0;
    margin-bottom: 0.4rem;
  }

  small {
    font-size: 0.8rem;
  }

  .small {
    font-size: 0.82rem;
    margin: 0;
  }
</style>
