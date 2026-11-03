<script lang="ts">
  import type { AppletSummary, MountPlan, SampleApplet, ShellKernl, StorageLike } from './contract';
  import { abbreviate } from './contract';
  import { domainChoices, domainLabel, type DomainChoice } from './domains';
  import Overlay from './Overlay.svelte';
  import { forgetRecent, readRecent, rememberRecent, type RecentApplet } from './recent';

  interface Props {
    kernl: ShellKernl;
    samples: readonly SampleApplet[];
    storage: StorageLike;
    initialAddress?: string;
    onclose: () => void;
    onopen: (plan: MountPlan) => void;
  }

  const { kernl, samples, storage, initialAddress = '', onclose, onopen }: Props = $props();

  interface Choice extends DomainChoice {
    on: boolean;
  }

  // The address the shell resolves stays in state; the field only ever shows what the person
  // typed, and is cleared once an applet is found, so a raw address is never echoed back (D-006).
  let address = $state(initialAddress);
  let typed = $state('');
  let summary = $state.raw<AppletSummary | null>(null);
  let choices = $state<Choice[]>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let recent = $state.raw<readonly RecentApplet[]>(readRecent(storage));

  const missing = $derived(choices.filter((choice) => choice.required && !choice.on));
  const listWords = (words: readonly string[]): string => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

  /** Exact reasons first, then reason prefixes; anything else gets one generic sentence, never the raw reason. */
  const ERRORS: Readonly<Record<string, string>> = {
    'invalid:pointer': 'That does not look like an applet address.',
    'invalid:unresolved': 'The applet could not be prepared. Look it up again.',
    'invalid:frame-detached': 'The applet window closed before the applet could start.',
    'unavailable:preview-offline': 'The preview runs offline. Pick one of the sample applets below.',
    'unavailable:manifest': 'No applet was found at that address. Check it and try again.',
    'unavailable:blob': 'The applet was found, but its file could not be downloaded right now. Try again later.',
    'unavailable:frame-lock': 'This applet could not be sealed safely, so the shell did not open it.',
    'denied:blocked': 'You blocked this applet. Unblock it from its grants first.',
    'denied:signed-out': 'Sign in to open applets.',
  };
  const PREFIXES: readonly (readonly [string, string])[] = [
    ['invalid:', 'This applet did not pass the shell\'s checks, so it was not opened.'],
    ['unavailable:', 'The applet cannot be reached right now. Try again later.'],
    ['denied:', 'The shell refused to open this applet.'],
    ['timeout', 'Looking up the applet took too long. Try again.'],
  ];
  const GENERIC_ERROR = 'Could not open the applet. Try again, or try another address.';

  const explain = (reason: unknown): string => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const code = message.split(' ')[0] ?? '';
    return ERRORS[message] ?? ERRORS[code] ?? PREFIXES.find(([prefix]) => code.startsWith(prefix))?.[1] ?? GENERIC_ERROR;
  };

  async function resolve(target = typed): Promise<void> {
    address = target.trim();
    error = null;
    busy = true;
    try {
      const found = await kernl.resolve(kernl.decodePointer(address));
      const record = kernl.grants.get(found.identity);
      const input = { requires: found.requires, optional: found.optional, baseline: kernl.grants.baselineDomains(), granted: record?.domains ?? [], firstRun: record === undefined };
      choices = domainChoices(input).map((choice) => ({ ...choice, on: choice.granted || choice.preset }));
      summary = found;
      typed = '';
    } catch (reason) {
      error = explain(reason);
    } finally {
      busy = false;
    }
  }

  async function run(): Promise<void> {
    if (!summary) return;
    busy = true;
    error = null;
    try {
      for (const choice of choices) {
        if (choice.baseline) continue;
        if (choice.on && !choice.granted) kernl.grants.allowDomain(summary.identity, choice.domain);
        if (!choice.on && choice.granted) kernl.grants.revokeDomain(summary.identity, choice.domain);
      }
      const plan = await kernl.plan(summary);
      recent = rememberRecent(storage, { address, title: summary.title, publisher: summary.publisher });
      onopen(plan);
    } catch (reason) {
      error = explain(reason);
      busy = false;
    }
  }

  function back(): void {
    summary = null;
    error = null;
  }

  $effect(() => {
    if (initialAddress) void resolve(initialAddress);
  });
</script>

<Overlay title="Open an applet" {onclose}>
  {#if summary}
    {@const applet = summary}
    <article class="summary" aria-live="polite">
      <header>
        <h3>{applet.title}</h3>
        <p class="shell-muted">by <span class="mono">{abbreviate(applet.publisher)}</span></p>
      </header>
      <p>{applet.description}</p>
      {#if choices.length}
        <h4>What it may use</h4>
        <ul class="shell-list choices">
          {#each choices as choice (choice.domain)}
            <li class="shell-toggle">
              <label class="text" for="grant-{choice.domain}">
                <span>{choice.label}</span>
                <small>{choice.baseline ? 'always on' : choice.required ? 'the applet says it needs this' : 'optional'}</small>
              </label>
              <input id="grant-{choice.domain}" type="checkbox" bind:checked={choice.on} disabled={choice.baseline} />
            </li>
          {/each}
        </ul>
      {:else}
        <p class="shell-muted">This applet asks for nothing beyond the baseline.</p>
      {/if}
      {#if missing.length}
        <p class="warning" role="status">Without {listWords(missing.map((choice) => domainLabel(choice.domain)))}, this applet may not work. You can still run it.</p>
      {/if}
      {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
      <div class="shell-actions">
        <button type="button" class="shell-button primary" onclick={run} disabled={busy}>Run</button>
        <button type="button" class="shell-button quiet" onclick={back} disabled={busy}>Back</button>
      </div>
    </article>
  {:else}
    <form class="address" onsubmit={(event) => (event.preventDefault(), resolve())}>
      <label class="shell-field">
        <span>Applet address</span>
        <input class="shell-input mono" type="text" bind:value={typed} placeholder="Paste an address" autocomplete="off" spellcheck="false" />
      </label>
      {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
      <div class="shell-actions">
        <button type="submit" class="shell-button primary" disabled={busy || !typed.trim()}>{busy ? 'Checking…' : 'Look up'}</button>
      </div>
    </form>
    {#if samples.length}
      <section class="shell-section">
        <h3>Sample applets</h3>
        <ul class="shell-list">
          {#each samples as sample (sample.address)}
            <li class="shell-card row">
              <div>
                <h4>{sample.title}</h4>
                <p>{sample.blurb}</p>
              </div>
              <button type="button" class="shell-button" onclick={() => resolve(sample.address)} disabled={busy}>Open</button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    {#if recent.length}
      <section class="shell-section">
        <h3>Recent</h3>
        <ul class="shell-list">
          {#each recent as entry (entry.address)}
            <li class="shell-card row">
              <div>
                <h4>{entry.title}</h4>
                <p class="mono">{abbreviate(entry.publisher)}</p>
              </div>
              <div class="shell-actions">
                <button type="button" class="shell-button" onclick={() => resolve(entry.address)} disabled={busy}>Open</button>
                <button type="button" class="shell-button quiet" onclick={() => (recent = forgetRecent(storage, entry.address))} aria-label="Forget {entry.title}">Forget</button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</Overlay>

<style>
  .address {
    display: grid;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .summary {
    display: grid;
    gap: 0.75rem;
  }

  .summary header {
    display: grid;
    gap: 0.1rem;
  }

  .summary h3 {
    margin: 0;
    font-size: 1.4rem;
  }

  .summary h4 {
    margin: 0.5rem 0 0;
    font-size: 0.95rem;
  }

  .summary p {
    margin: 0;
  }

  .choices {
    gap: 0;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .warning {
    border-left: 2px solid var(--accent);
    padding-left: 0.75rem;
    color: var(--ink-muted);
    font-size: 0.9rem;
  }

  .row {
    grid-template-columns: 1fr auto;
    align-items: center;
  }
</style>
