<script lang="ts">
  import type { RelayTier, ShellKernl } from '../contract';
  import { observe } from '../observe.svelte';
  import { serverAddress, serverLabel } from '../servers';

  interface Props {
    kernl: ShellKernl;
  }

  type LookupTier = Exclude<RelayTier, 'outbox'>;

  const { kernl }: Props = $props();
  const tiers = observe(kernl.relays.changes$, kernl.relays.get());
  $effect(() => tiers.stop);

  // The outbox tier is not listed: it follows the identity's published outbox, edited under "Inbox and outbox" (D-029).
  const TIERS: readonly { id: LookupTier; label: string; help: string }[] = [
    { id: 'discovery', label: 'People lookup', help: 'Where the shell finds profiles, follow lists and other people\'s inbox and outbox.' },
    { id: 'apps', label: 'Applet catalogue', help: 'Where applets are published and verified from.' },
    { id: 'super', label: 'General', help: 'Asked for everything else, and for anyone who has not listed their own servers.' },
  ];

  let drafts = $state<Record<LookupTier, string>>({ discovery: '', apps: '', super: '' });
  let error = $state<string | null>(null);

  function add(tier: LookupTier): void {
    error = null;
    try {
      kernl.relays.add(tier, serverAddress(drafts[tier]));
      drafts[tier] = '';
    } catch (reason) {
      error = reason instanceof Error && reason.message.startsWith('invalid:') ? 'Enter a server address such as nos.lol.' : 'That server could not be added.';
    }
  }
</script>

<section class="shell-section" aria-labelledby="lookup-servers-heading">
  <h3 id="lookup-servers-heading">How the shell finds things</h3>
  <p class="shell-muted small">Servers the shell itself asks, on your behalf; applets never connect to anything. Your own posts go to your outbox first.</p>
  <div class="tiers">
    {#each TIERS as tier (tier.id)}
      <div class="shell-card tier">
        <h4>{tier.label}</h4>
        <p>{tier.help}</p>
        <ul class="shell-list urls">
          {#each tiers.value[tier.id] as url, index (url)}
            {@const name = serverLabel(url, tier.label, index)}
            <li data-address={url}><span class="server">{name}</span><button type="button" class="shell-button quiet" onclick={() => kernl.relays.remove(tier.id, url)} aria-label="Remove {name} from {tier.label}">Remove</button></li>
          {:else}
            <li class="shell-muted">None configured.</li>
          {/each}
        </ul>
        <form class="add" onsubmit={(event) => (event.preventDefault(), add(tier.id))}>
          <label class="shell-field"><span>Add a server to {tier.label}</span><input class="shell-input mono" type="text" inputmode="url" autocomplete="off" spellcheck="false" bind:value={drafts[tier.id]} placeholder="nos.lol" /></label>
          <button type="submit" class="shell-button" disabled={!drafts[tier.id].trim()}>Add</button>
        </form>
      </div>
    {/each}
  </div>
  {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
</section>

<style>
  .small {
    font-size: 0.85rem;
    margin: 0;
  }

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
