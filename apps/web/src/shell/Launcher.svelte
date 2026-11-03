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

  let address = $state(initialAddress);
  let summary = $state.raw<AppletSummary | null>(null);
  let choices = $state<Choice[]>([]);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let recent = $state.raw<readonly RecentApplet[]>(readRecent(storage));

  const missing = $derived(choices.filter((choice) => choice.required && !choice.on));
  const listWords = (words: readonly string[]): string => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

  const ERRORS: Readonly<Record<string, string>> = {
    'invalid:pointer': 'That does not look like an applet address.',
    'unavailable:preview-offline': 'The preview runs offline. Pick one of the sample applets below.',
    'denied:blocked': 'You blocked this applet. Unblock it from its grants first.',
  };

  const explain = (reason: unknown): string => {
    const message = reason instanceof Error ? reason.message : String(reason);
    return ERRORS[message] ?? ERRORS[message.split(' ')[0] ?? ''] ?? `Could not open the applet (${message}).`;
  };

  async function resolve(target = address): Promise<void> {
    address = target;
    error = null;
    busy = true;
    try {
      const found = await kernl.resolve(kernl.decodePointer(target));
      const record = kernl.grants.get(found.identity);
      const input = { requires: found.requires, optional: found.optional, baseline: kernl.grants.baselineDomains(), granted: record?.domains ?? [], firstRun: record === undefined };
      choices = domainChoices(input).map((choice) => ({ ...choice, on: choice.granted || choice.preset }));
      summary = found;
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
        <input class="shell-input mono" type="text" bind:value={address} placeholder="Paste an applet address" autocomplete="off" spellcheck="false" />
      </label>
      {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
      <div class="shell-actions">
        <button type="submit" class="shell-button primary" disabled={busy || !address.trim()}>{busy ? 'Checking…' : 'Look up'}</button>
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
