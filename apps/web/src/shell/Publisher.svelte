<script lang="ts">
  import type { ShellKernl } from './contract';
  import { isBuiltInApplet } from './contract';
  import PersonName from './PersonName.svelte';

  interface Props {
    kernl: ShellKernl;
    applet: { readonly address: string; readonly publisher: string };
  }

  const { kernl, applet }: Props = $props();
</script>

{#if isBuiltInApplet(applet.address)}comes with kernl{:else}by <PersonName {kernl} pubkey={applet.publisher} />{/if}
