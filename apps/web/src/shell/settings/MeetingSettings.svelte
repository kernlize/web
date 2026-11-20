<script lang="ts">
  import type { MultiplayerState, ToolFamilyCandidate } from '@kernlize/core';
  import type { ShellKernl } from '../contract';
  import { abbreviate } from '../contract';
  import { helperFrom, toolSearchWords } from '../meeting-words';
  import { observe } from '../observe.svelte';
  import { hostOf, serverAddress } from '../servers';

  interface Props {
    kernl: ShellKernl;
  }

  const { kernl }: Props = $props();

  const chosen = observe<MultiplayerState>(kernl.multiplayer.state$, kernl.multiplayer.state());
  $effect(() => chosen.stop);
  const tiers = observe(kernl.relays.changes$, kernl.relays.get());
  $effect(() => tiers.stop);

  let server = $state('');
  let helper = $state({ address: '', username: '', credential: '' });
  let search = $state('');
  let searching = $state(false);
  let found = $state.raw<readonly ToolFamilyCandidate[]>([]);
  let labels = $state<Record<string, string>>({});
  let error = $state<string | null>(null);

  const servers = $derived(chosen.value.servers ?? tiers.value.super);
  const helpers = $derived(chosen.value.helpers ?? []);

  function attempt(change: () => void, words: string): void {
    error = null;
    try {
      change();
    } catch {
      error = words;
    }
  }

  function addServer(): void {
    attempt(() => kernl.multiplayer.setServers([...servers, serverAddress(server)]), 'Enter a relay address such as nos.lol.');
    if (!error) server = '';
  }

  function addHelper(): void {
    attempt(() => kernl.multiplayer.setHelpers([...helpers, helperFrom(helper.address, helper.username, helper.credential)]), 'Enter a helper address that starts with stun: or turn:.');
    if (!error) helper = { address: '', username: '', credential: '' };
  }

  async function find(): Promise<void> {
    searching = true;
    error = null;
    found = [];
    try {
      found = await kernl.multiplayer.discover(search);
      labels = Object.fromEntries(found.map((candidate) => [candidate.eventId, candidate.family.family]));
    } catch (reason) {
      error = toolSearchWords(reason);
    } finally {
      searching = false;
    }
  }

  function trust(candidate: ToolFamilyCandidate): void {
    attempt(() => kernl.multiplayer.saveFamily({ ...candidate.family, family: (labels[candidate.eventId] ?? '').trim() }), 'Give the tools a name.');
    if (!error) found = found.filter((entry) => entry !== candidate);
  }
</script>

<section class="shell-section" aria-labelledby="meeting-heading">
  <h3 id="meeting-heading">Meeting people and remote tools</h3>
  <p class="shell-muted small">You are asked before every meeting.</p>

  <div class="shell-card part">
    <h4>Relays for meeting people</h4>
    <p>They do not see what you and the people you meet send.</p>
    {#if !chosen.value.servers}<p class="small" role="status">Using the general relays.</p>{/if}
    <ul class="shell-list urls" aria-label="Relays for meeting people">
      {#each servers as url (url)}
        {@const name = hostOf(url)}
        <li data-address={url}><span class="server">{name}</span><button type="button" class="shell-button quiet" onclick={() => attempt(() => kernl.multiplayer.setServers(servers.filter((entry) => entry !== url)), 'That relay could not be removed.')} aria-label="Remove {name} from relays for meeting people">Remove</button></li>
      {:else}
        <li class="shell-muted">None, so nobody can be introduced.</li>
      {/each}
    </ul>
    <form class="add" onsubmit={(event) => (event.preventDefault(), addServer())}>
      <label class="shell-field"><span>Add a meeting relay</span><input class="shell-input mono" type="text" inputmode="url" autocomplete="off" spellcheck="false" bind:value={server} placeholder="nos.lol" /></label>
      <button type="submit" class="shell-button" disabled={!server.trim()}>Add</button>
    </form>
    {#if chosen.value.servers}<button type="button" class="shell-button quiet" onclick={() => kernl.multiplayer.setServers(undefined)}>Use the general relays</button>{/if}
  </div>

  <div class="shell-card part">
    <h4>Connection helpers</h4>
    <p>A helper learns your network address and that you are talking.</p>
    <ul class="shell-list urls" aria-label="Connection helpers">
      {#each helpers as entry, index (index)}
        <li><span class="mono">{entry.urls.join(', ')}</span><button type="button" class="shell-button quiet" onclick={() => kernl.multiplayer.setHelpers(helpers.filter((other) => other !== entry))} aria-label="Remove connection helper {index + 1}">Remove</button></li>
      {:else}
        <li class="shell-muted">None, so you may reach only your own network.</li>
      {/each}
    </ul>
    <form class="helper" onsubmit={(event) => (event.preventDefault(), addHelper())}>
      <label class="shell-field"><span>Helper address</span><input class="shell-input mono" type="text" autocomplete="off" spellcheck="false" bind:value={helper.address} placeholder="stun:helper.example:3478" /></label>
      <label class="shell-field"><span>Name</span><input class="shell-input" type="text" autocomplete="off" bind:value={helper.username} placeholder="optional" /></label>
      <label class="shell-field"><span>Password</span><input class="shell-input" type="password" autocomplete="off" bind:value={helper.credential} placeholder="optional" /></label>
      <button type="submit" class="shell-button" disabled={!helper.address.trim()}>Add</button>
    </form>
  </div>

  <div class="shell-card part">
    <h4>Tools you trust</h4>
    <p>Applets ask for tools by the name you give them.</p>
    <ul class="shell-list" aria-label="Tools you trust">
      {#each chosen.value.families as family (`${family.family}:${family.server.pubkey}`)}
        <li><span><strong>{family.family}</strong> · {family.tools.map((tool) => tool.name).join(', ')} · from {abbreviate(family.server.pubkey)}</span><button type="button" class="shell-button quiet" onclick={() => kernl.multiplayer.removeFamily(family.family, family.server.pubkey)} aria-label="Stop trusting {family.family}">Remove</button></li>
      {:else}
        <li class="shell-muted">None yet.</li>
      {/each}
    </ul>
    <form class="add" onsubmit={(event) => (event.preventDefault(), void find())}>
      <label class="shell-field"><span>Find tools</span><input class="shell-input mono" type="text" autocomplete="off" spellcheck="false" bind:value={search} placeholder="Reference, fingerprint or website" /></label>
      <button type="submit" class="shell-button" disabled={!search.trim() || searching}>{searching ? 'Looking…' : 'Look'}</button>
    </form>
    {#each found as candidate (candidate.eventId)}
      <form class="candidate" aria-label="Tools from {abbreviate(candidate.family.server.pubkey)}" onsubmit={(event) => (event.preventDefault(), trust(candidate))}>
        <p>{candidate.family.tools.map((tool) => tool.name).join(', ')} · from {abbreviate(candidate.family.server.pubkey)}</p>
        <label class="shell-field"><span>Name these tools</span><input class="shell-input" type="text" autocomplete="off" bind:value={labels[candidate.eventId]} /></label>
        <button type="submit" class="shell-button primary">Trust</button>
      </form>
    {/each}
  </div>
  {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
</section>

<style>
  .small {
    font-size: 0.85rem;
    margin: 0;
  }

  .part {
    display: grid;
    gap: 0.5rem;
  }

  .part h4,
  .part p {
    margin: 0;
  }

  .urls li,
  .shell-list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    max-width: none;
  }

  .add,
  .candidate {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: 0.5rem;
  }

  .candidate p {
    grid-column: 1 / -1;
  }

  .helper {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    align-items: end;
    gap: 0.5rem;
  }

  /* One text size for the three fields, so their labels sit on one line. */
  .helper .shell-input {
    font-size: 0.85rem;
    line-height: 1.4;
  }
</style>
