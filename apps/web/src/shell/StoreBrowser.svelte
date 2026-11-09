<script lang="ts">
  import { onMount } from 'svelte';
  import type { CatalogEntry, ShellKernl } from './contract';
  import { abbreviate } from './contract';
  import { acceptsWords, looksLikeAddress, missingDomains, toggleTopic, topicBubbles } from './store';

  interface Props {
    kernl: ShellKernl;
    /** Only applets that accept this convention, for the handler chooser. */
    convention?: string;
    busy?: boolean;
    /** Pre-filled search text, such as an address passed in the link. */
    initialText?: string;
    onpick: (entry: CatalogEntry) => void;
    onaddress: (address: string) => void;
  }

  const { kernl, convention, busy = false, initialText = '', onpick, onaddress }: Props = $props();

  type CoreSearch = Pick<typeof import('@kernlize/core'), 'searchCatalog' | 'popularTopics'>;

  const PAGE = 40;
  let text = $state(initialText);
  let topics = $state<string[]>([]);
  // Every published applet is listed, as the public stores do; each one this shell cannot fully run says what it needs (D-031).
  let workingOnly = $state(false);
  let shown = $state(PAGE);
  let entries = $state.raw<readonly CatalogEntry[] | null>(null);
  let failed = $state(false);
  let search = $state.raw<CoreSearch | null>(null);

  const available = $derived([...kernl.grants.availableDomains(), ...kernl.grants.baselineDomains()]);
  const pasted = $derived(looksLikeAddress(text));
  const base = $derived(convention === undefined ? {} : { convention });
  const all = $derived(search && entries ? search.searchCatalog(entries, { ...base, text: pasted ? '' : text, topics }) : []);
  const working = $derived(search && entries ? search.searchCatalog(entries, { ...base, text: pasted ? '' : text, topics, available }) : []);
  const results = $derived(workingOnly ? working : all);
  const limited = $derived(all.length - working.length);
  const bubbles = $derived(search && entries ? topicBubbles(search.popularTopics(search.searchCatalog(entries, base), 14), topics) : []);

  let finished = $state(false);

  onMount(() => {
    // The search helpers come from the core on first use, so it stays out of the shell's first chunk.
    void import('@kernlize/core').then((core) => (search = core));
    // Applets are listed as each server sends them; the list never waits for the slowest one.
    const listing = kernl.catalog.stream().subscribe({
      next: (found) => (entries = found),
      error: () => {
        failed = entries === null || entries.length === 0;
        finished = true;
        entries ??= [];
      },
      complete: () => {
        finished = true;
        entries ??= [];
      },
    });
    return () => listing.unsubscribe();
  });

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (pasted) onaddress(text.trim());
  }

  function pickTopic(topic: string): void {
    topics = toggleTopic(topics, topic);
    shown = PAGE;
  }
</script>

<div class="store">
  <form class="search" onsubmit={submit} role="search">
    <label class="shell-field">
      <span>Find an applet</span>
      <input class="shell-input" type="search" bind:value={text} oninput={() => (shown = PAGE)} placeholder="Search, or paste an applet address" autocomplete="off" spellcheck="false" />
    </label>
  </form>

  {#if pasted}
    <div class="shell-card row pasted">
      <div>
        <h4>Open this address</h4>
        <p class="mono">{abbreviate(text.trim())}</p>
      </div>
      <button type="button" class="shell-button primary" onclick={() => onaddress(text.trim())} disabled={busy}>{busy ? 'Checking…' : 'Look up'}</button>
    </div>
  {/if}

  {#if bubbles.length}
    <div class="bubbles" role="group" aria-label="Topics">
      {#each bubbles as bubble (bubble.topic)}
        <button type="button" class="bubble" class:on={bubble.on} aria-pressed={bubble.on} onclick={() => pickTopic(bubble.topic)}>
          {bubble.topic}<span class="count">{bubble.count}</span>
        </button>
      {/each}
    </div>
  {/if}

  <label class="shell-toggle works">
    <span class="text">
      <span>Only applets that work here</span>
      {#if limited > 0}<small>{limited} {limited === 1 ? 'applet needs' : 'applets need'} something this shell does not offer{workingOnly ? ', hidden' : ', marked below'}</small>{/if}
    </span>
    <input type="checkbox" bind:checked={workingOnly} />
  </label>

  {#if entries === null || search === null}
    <p class="shell-muted" role="status">Looking for applets…</p>
  {:else if failed}
    <p class="shell-error" role="alert">The store could not be reached. You can still paste an applet address above.</p>
  {:else if results.length === 0}
    <p class="shell-muted" role="status">{convention ? 'No listed applet can do this yet.' : 'No applets match.'}{finished ? '' : ' More may still arrive.'}</p>
  {:else}
    <ul class="shell-list results" aria-label="Applets">
      {#each results.slice(0, shown) as entry (entry.catalogId)}
        {@const missing = missingDomains(entry, available)}
        <li class="shell-card entry">
          <div class="icon" aria-hidden="true">
            {#if entry.iconUrl}<img src={entry.iconUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />{:else}{entry.title.charAt(0).toUpperCase()}{/if}
          </div>
          <div class="text">
            <h4>{entry.title}</h4>
            {#if entry.description}<p class="description">{entry.description}</p>{/if}
            {#if entry.conventions.length}<p class="shell-muted small">Takes requests to {acceptsWords(entry.conventions)}.</p>{/if}
            {#if missing.length}<p class="small needs">Needs {missing.join(', ')}, which this shell does not offer.</p>{/if}
            {#if entry.topics.length}
              <div class="tags">
                {#each entry.topics.slice(0, 5) as topic (topic)}
                  <button type="button" class="tag" onclick={() => pickTopic(topic)}>{topic}</button>
                {/each}
              </div>
            {/if}
          </div>
          <button type="button" class="shell-button" onclick={() => onpick(entry)} disabled={busy} aria-label="Open {entry.title}">Open</button>
        </li>
      {/each}
    </ul>
    {#if !finished}<p class="shell-muted small" role="status">Still hearing from the network; more applets may appear.</p>{/if}
    {#if results.length > shown}
      <button type="button" class="shell-button quiet more" onclick={() => (shown += PAGE)}>Show more ({results.length - shown} left)</button>
    {/if}
  {/if}
</div>

<style>
  .store {
    display: grid;
    gap: 0.9rem;
    min-width: 0;
  }

  .search {
    display: grid;
  }

  .row {
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .bubbles,
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .bubble,
  .tag {
    font: inherit;
    font-size: 0.82rem;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--ink);
    border-radius: 999px;
    padding: 0.2rem 0.65rem;
    cursor: pointer;
    display: inline-flex;
    gap: 0.4rem;
    align-items: baseline;
  }

  .tag {
    font-size: 0.75rem;
    padding: 0.05rem 0.5rem;
    color: var(--ink-muted);
  }

  .bubble:hover,
  .tag:hover {
    border-color: var(--accent);
  }

  .bubble.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
  }

  .count {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    opacity: 0.75;
  }

  .works {
    padding: 0;
  }

  .entry {
    grid-template-columns: 2.75rem minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.85rem;
  }

  .icon {
    width: 2.75rem;
    height: 2.75rem;
    border-radius: 10px;
    background: var(--accent-soft);
    color: var(--accent);
    display: grid;
    place-items: center;
    font-weight: 700;
    overflow: hidden;
  }

  .icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .text {
    display: grid;
    gap: 0.3rem;
    min-width: 0;
  }

  .description {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .small {
    font-size: 0.82rem;
  }

  .needs {
    color: var(--accent);
  }

  .more {
    justify-self: center;
  }

  @media (max-width: 720px) {
    .entry {
      grid-template-columns: 2.25rem minmax(0, 1fr);
    }

    .icon {
      width: 2.25rem;
      height: 2.25rem;
    }

    .entry > .shell-button {
      grid-column: 2;
      justify-self: start;
    }
  }
</style>
