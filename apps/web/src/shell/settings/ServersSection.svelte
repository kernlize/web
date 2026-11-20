<script lang="ts">
  import type { BootMode, ShellKernl } from '../contract';
  import FileServerSettings from './FileServerSettings.svelte';
  import LookupServerSettings from './LookupServerSettings.svelte';
  import MailboxSettings from './MailboxSettings.svelte';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
  }

  const { kernl, mode }: Props = $props();
</script>

<MailboxSettings {kernl} {mode} />
<FileServerSettings {kernl} />
<LookupServerSettings {kernl} />
