<script lang="ts">
  import type { RelayTier, ShellKernl } from '../contract';
  import { observe } from '../observe.svelte';
  import { hostOf, serverAddress } from '../servers';

  interface Props {
    kernl: ShellKernl;
  }

  type LookupTier = Exclude<RelayTier, 'outbox'>;

  const { kernl }: Props = $props();
  const tiers = observe(kernl.relays.changes$, kernl.relays.get());
  $effect(() => tiers.stop);

  // The outbox tier is not listed: it follows the identity's published outbox, edited under "Inbox and outbox" (D-029).
  const TIERS: readonly { id: LookupTier; label: string; help: string; field: string }[] = [
    { id: 'discovery', label: 'Lookup relays', help: 'Profiles and follow lists.', field: 'Add a lookup relay' },
    { id: 'apps', label: 'Applet relays', help: 'Where applets come from.', field: 'Add an applet relay' },
    { id: 'super', label: 'General relays', help: 'Everything else.', field: 'Add a general relay' },
  ];

  let drafts = $state<Record<LookupTier, string>>({ discovery: '', apps: '', super: '' });
  let error = $state<string | null>(null);

  function add(tier: LookupTier): void {
    error = null;
    try {
      kernl.relays.add(tier, serverAddress(drafts[tier]));
      drafts[tier] = '';
    } catch (reason) {
      error = reason instanceof Error && reason.message.startsWith('invalid:') ? 'Enter a relay address such as nos.lol.' : 'That relay could not be added.';
    }
  }
</script>

<section class="shell-section" aria-labelledby="lookup-servers-heading">
  <h3 id="lookup-servers-heading">Relays the shell asks</h3>
  <div class="tiers">
    {#each TIERS as tier (tier.id)}
      <div class="shell-card tier">
        <h4>{tier.label}</h4>
        <p>{tier.help}</p>
        <ul class="shell-list urls">
          {#each tiers.value[tier.id] as url (url)}
            {@const name = hostOf(url)}
            <li data-address={url}><span class="server">{name}</span><button type="button" class="shell-button quiet" onclick={() => kernl.relays.remove(tier.id, url)} aria-label="Remove {name} from {tier.label}">Remove</button></li>
          {:else}
            <li class="shell-muted">None.</li>
          {/each}
        </ul>
        <form class="add" onsubmit={(event) => (event.preventDefault(), add(tier.id))}>
          <label class="shell-field"><span>{tier.field}</span><input class="shell-input mono" type="text" inputmode="url" autocomplete="off" spellcheck="false" bind:value={drafts[tier.id]} placeholder="nos.lol" /></label>
          <button type="submit" class="shell-button" disabled={!drafts[tier.id].trim()}>Add</button>
        </form>
      </div>
    {/each}
  </div>
  {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
</section>

<style>
  .tiers {
    display: grid;
    gap: 0.75rem;
  }

  /* The window's own width, not the page's: Settings is resized and tiled on its own (D-049). */
  @container (min-width: 36rem) {
    .tiers {
      grid-template-columns: 1fr 1fr;
    }
  }

  .urls li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    max-width: none;
  }

  .urls .server {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .add {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: 0.5rem;
  }
</style>
