<script lang="ts">
  import type { ShellKernl } from './contract';
  import { abbreviate } from './contract';
  import { observe } from './observe.svelte';

  interface Props {
    kernl: ShellKernl;
    pubkey: string;
    /** A name the shell already holds, such as an account's own label; wins over the profile. */
    known?: string | undefined;
  }

  const { kernl, pubkey, known }: Props = $props();
  // A person is shown by the name they published; the short key stands in until it arrives, never instead of looking.
  const card = $derived(observe(kernl.profiles.card$(pubkey), kernl.profiles.card(pubkey)));
  $effect(() => card.stop);
  const name = $derived(known ?? (card.value.found ? card.value.name : abbreviate(pubkey)));
</script>

<span class="person" class:mono={known === undefined && !card.value.found} title={card.value.nip05 ?? undefined}>{name}</span>
