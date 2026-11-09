<script lang="ts">
  import type { AppletSummary, ShellKernl } from './contract';
  import { abbreviate } from './contract';
  import { domainChoices, domainLabel, type DomainChoice } from './domains';
  import { explainLaunchError } from './launch-errors';
  import { acceptsWords } from './store';

  interface Props {
    kernl: ShellKernl;
    summary: AppletSummary;
    /** The primary button's words: "Run", or "Use this applet" in the chooser. */
    action: string;
    onback: () => void;
    /** Called after the user's grant choices were written. Throw to show an error. */
    onconfirm: (summary: AppletSummary) => Promise<void>;
  }

  const { kernl, summary, action, onback, onconfirm }: Props = $props();

  interface Choice extends DomainChoice {
    on: boolean;
  }

  const initialChoices = (): Choice[] => {
    const record = kernl.grants.get(summary.identity);
    const input = {
      requires: summary.requires,
      optional: summary.optional,
      baseline: kernl.grants.baselineDomains(),
      granted: record?.domains ?? [],
      firstRun: record === undefined,
      receives: summary.manifest.archetypes.length > 0,
    };
    return domainChoices(input).map((choice) => ({ ...choice, on: choice.granted || choice.preset }));
  };

  let choices = $state<Choice[]>(initialChoices());
  let busy = $state(false);
  let error = $state<string | null>(null);

  const missing = $derived(choices.filter((choice) => choice.required && !choice.on));
  const offered = $derived(kernl.grants.availableDomains());
  const unavailable = $derived(summary.requires.filter((domain) => !offered.includes(domain) && !kernl.grants.baselineDomains().includes(domain)));
  const accepts = $derived(acceptsWords(summary.manifest.archetypes.map((entry) => entry.convention)));
  const listWords = (words: readonly string[]): string => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);

  async function confirm(): Promise<void> {
    busy = true;
    error = null;
    try {
      for (const choice of choices) {
        if (choice.baseline || !offered.includes(choice.domain)) continue;
        if (choice.on && !choice.granted) kernl.grants.allowDomain(summary.identity, choice.domain);
        if (!choice.on && choice.granted) kernl.grants.revokeDomain(summary.identity, choice.domain);
      }
      await onconfirm(summary);
    } catch (reason) {
      error = explainLaunchError(reason);
    } finally {
      busy = false;
    }
  }
</script>

<article class="summary" aria-live="polite">
  <header>
    <h3>{summary.title}</h3>
    <p class="shell-muted">by <span class="mono">{abbreviate(summary.publisher)}</span></p>
  </header>
  {#if summary.description}<p>{summary.description}</p>{/if}
  {#if accepts}<p class="shell-muted">Other applets can ask it to {accepts}.</p>{/if}
  {#if choices.length}
    <h4>What it may use</h4>
    <ul class="shell-list choices">
      {#each choices as choice (choice.domain)}
        <li class="shell-toggle">
          <label class="text" for="grant-{choice.domain}">
            <span>{choice.label}</span>
            <small>{choice.baseline ? 'always on' : !offered.includes(choice.domain) ? 'this shell does not offer it' : choice.required ? 'the applet says it needs this' : 'optional'}</small>
          </label>
          <input id="grant-{choice.domain}" type="checkbox" bind:checked={choice.on} disabled={choice.baseline || !offered.includes(choice.domain)} />
        </li>
      {/each}
    </ul>
  {:else}
    <p class="shell-muted">This applet asks for nothing beyond the baseline.</p>
  {/if}
  {#if unavailable.length}
    <p class="warning" role="status">It needs {listWords(unavailable.map(domainLabel))}, which this shell does not offer. Parts of it may not work.</p>
  {:else if missing.length}
    <p class="warning" role="status">Without {listWords(missing.map((choice) => domainLabel(choice.domain)))}, this applet may not work. You can still run it.</p>
  {/if}
  {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
  <div class="shell-actions">
    <button type="button" class="shell-button primary" onclick={confirm} disabled={busy}>{action}</button>
    <button type="button" class="shell-button quiet" onclick={onback} disabled={busy}>Back</button>
  </div>
</article>

<style>
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
</style>
