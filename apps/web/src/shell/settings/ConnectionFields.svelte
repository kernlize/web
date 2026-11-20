<script lang="ts">
  import { DOWNLOAD_PROGRAMS, type DownloadConnection, type DownloadProgram } from '@kernlize/core';
  import { fieldLabel, hasSecret, isSecretField, type ProgramDraft } from '../download-programs';

  interface Props {
    program: DownloadProgram;
    /** The saved connection, for which secrets are kept; undefined in the add form. */
    connection: DownloadConnection | undefined;
    draft: ProgramDraft;
  }

  let { program, connection, draft = $bindable() }: Props = $props();
  const info = $derived(DOWNLOAD_PROGRAMS[program]);
</script>

<label class="shell-field">
  <span>Name</span>
  <input class="shell-input" type="text" autocomplete="off" maxlength="60" bind:value={draft.label} placeholder={connection ? '' : info.name} />
</label>
<label class="shell-field">
  <span>Address</span>
  <input class="shell-input mono" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={draft.url} placeholder={info.example} />
</label>
{#each info.signIn as field (field)}
  <label class="shell-field">
    <span>{fieldLabel(field)}</span>
    <input
      class="shell-input mono"
      type={isSecretField(field) ? 'password' : 'text'}
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      bind:value={draft[field]}
      placeholder={hasSecret(connection, field) ? 'Saved' : ''}
    />
  </label>
{/each}
