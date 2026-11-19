<script lang="ts">
  import type { MultiplayerState, ToolFamilyCandidate } from '@kernlize/core';
  import type { ShellKernl } from './contract';
  import { abbreviate } from './contract';
  import { helperFrom, toolSearchWords } from './meeting-words';
  import { observe } from './observe.svelte';
  import { serverAddress, serverLabel } from './servers';

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
    attempt(() => kernl.multiplayer.setServers([...servers, serverAddress(server)]), 'Enter a server address such as nos.lol.');
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
    attempt(() => kernl.multiplayer.saveFamily({ ...candidate.family, family: (labels[candidate.eventId] ?? '').trim() }), 'Give the tools a name, so applets can ask for them by it.');
    if (!error) found = found.filter((entry) => entry !== candidate);
  }
</script>

<section class="shell-section" aria-labelledby="meeting-heading">
  <h3 id="meeting-heading">Meeting people and remote tools</h3>
  <p class="shell-muted small">Some applets let you meet other people who run them, or use tools that run elsewhere. You are asked before every meeting, and only applets you allow can do either.</p>

  <div class="shell-card part">
    <h4>Servers that introduce you</h4>
    <p>They introduce you to people in an applet's rooms and carry sealed requests to tools. What you and the people you meet send each other does not pass through them.</p>
    {#if !chosen.value.servers}<p class="small" role="status">Using the shell's general servers.</p>{/if}
    <ul class="shell-list urls" aria-label="Servers that introduce you">
      {#each servers as url, index (url)}
        {@const name = serverLabel(url, 'Meeting', index)}
        <li data-address={url}><span class="server">{name}</span><button type="button" class="shell-button quiet" onclick={() => attempt(() => kernl.multiplayer.setServers(servers.filter((entry) => entry !== url)), 'That server could not be removed.')} aria-label="Remove {name} from servers that introduce you">Remove</button></li>
      {:else}
        <li class="shell-muted">None. Nobody can be introduced, and no tools found, until you add one.</li>
      {/each}
    </ul>
    <form class="add" onsubmit={(event) => (event.preventDefault(), addServer())}>
      <label class="shell-field"><span>Add a server that introduces you</span><input class="shell-input mono" type="text" inputmode="url" autocomplete="off" spellcheck="false" bind:value={server} placeholder="nos.lol" /></label>
      <button type="submit" class="shell-button" disabled={!server.trim()}>Add</button>
    </form>
    {#if chosen.value.servers}<button type="button" class="shell-button quiet" onclick={() => kernl.multiplayer.setServers(undefined)}>Use the general servers</button>{/if}
  </div>

  <div class="shell-card part">
    <h4>Connection helpers</h4>
    <p>Without one, you reach only people your device can reach directly, usually on the same network. A helper learns your network address, and one that carries the connection sees that you are talking, though not what you say.</p>
    <ul class="shell-list urls" aria-label="Connection helpers">
      {#each helpers as entry, index (index)}
        <li><span class="mono">{entry.urls.join(', ')}</span><button type="button" class="shell-button quiet" onclick={() => kernl.multiplayer.setHelpers(helpers.filter((other) => other !== entry))} aria-label="Remove connection helper {index + 1}">Remove</button></li>
      {:else}
        <li class="shell-muted">None.</li>
      {/each}
    </ul>
    <form class="helper" onsubmit={(event) => (event.preventDefault(), addHelper())}>
      <label class="shell-field"><span>Helper address</span><input class="shell-input mono" type="text" autocomplete="off" spellcheck="false" bind:value={helper.address} placeholder="stun:helper.example:3478" /></label>
      <label class="shell-field"><span>Name, if it asks for one</span><input class="shell-input" type="text" autocomplete="off" bind:value={helper.username} /></label>
      <label class="shell-field"><span>Password, if it asks for one</span><input class="shell-input" type="password" autocomplete="off" bind:value={helper.credential} /></label>
      <button type="submit" class="shell-button" disabled={!helper.address.trim()}>Add</button>
    </form>
  </div>

  <div class="shell-card part">
    <h4>Tools you trust</h4>
    <p>Applets can ask for tools by a name you give them here. Each tool is checked against what its server says it is before you see it, and again every time an applet uses it.</p>
    <ul class="shell-list" aria-label="Tools you trust">
      {#each chosen.value.families as family (`${family.family}:${family.server.pubkey}`)}
        <li><span><strong>{family.family}</strong> · {family.tools.map((tool) => tool.name).join(', ')} · from {abbreviate(family.server.pubkey)}</span><button type="button" class="shell-button quiet" onclick={() => kernl.multiplayer.removeFamily(family.family, family.server.pubkey)} aria-label="Stop trusting {family.family}">Remove</button></li>
      {:else}
        <li class="shell-muted">None yet.</li>
      {/each}
    </ul>
    <form class="add" onsubmit={(event) => (event.preventDefault(), void find())}>
      <label class="shell-field"><span>Find tools</span><input class="shell-input mono" type="text" autocomplete="off" spellcheck="false" bind:value={search} placeholder="A shared reference, a tool fingerprint, or a website" /></label>
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
</style>
