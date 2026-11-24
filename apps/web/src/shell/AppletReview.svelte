<script lang="ts">
  import Publisher from './Publisher.svelte';
  import type { AppletSummary, ShellKernl, StorageLike } from './contract';
  import { grantGroups, grantsToApply, startingChoices, type GrantChoices, type GrantInput, type GrantState } from '@kernlize/ui-model';
  import GrantList from './GrantList.svelte';
  import { explainOpenFailure } from './launcher-reasons';
  import { readRemember, writeRemember } from './remember-grants';
  import { acceptsWords } from './store';

  interface Props {
    kernl: ShellKernl;
    summary: AppletSummary;
    /** The primary button's words: "Run", or "Use this applet" in the chooser. */
    action: string;
    /** Where "Remember grants" is kept. Without it the grants are always remembered and the checkbox is not shown. */
    storage?: StorageLike;
    onback: () => void;
    /** Called after the user's grant choices were written. Throw to show an error. */
    onconfirm: (summary: AppletSummary) => Promise<void>;
  }

  const { kernl, summary, action, storage, onback, onconfirm }: Props = $props();

  const input: GrantInput = {
    requires: summary.requires,
    optional: summary.optional,
    baseline: kernl.grants.baselineDomains(),
    available: kernl.grants.availableDomains(),
    receives: summary.manifest.archetypes.length > 0,
  };
  const record = kernl.grants.get(summary.identity);
  const standing: GrantState = { granted: record?.domains ?? [], unsafe: record?.unsafe ?? [] };

  let choices = $state.raw<GrantChoices>(startingChoices(input, standing, true));
  let remember = $state(storage ? readRemember(storage) : true);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const groups = $derived(grantGroups(input, choices));
  const accepts = $derived(acceptsWords(summary.manifest.archetypes.map((entry) => entry.convention)));

  function change(domain: string, group: string, on: boolean): void {
    const next = { on: new Set(choices.on), kept: new Set(choices.kept) };
    const set = group === 'unsafe' ? next.kept : next.on;
    if (on) set.add(domain);
    else set.delete(domain);
    choices = next;
  }

  async function confirm(): Promise<void> {
    busy = true;
    error = null;
    try {
      for (const op of grantsToApply(input, choices, standing)) {
        if (op.kind === 'allow') kernl.grants.allowDomain(summary.identity, op.domain, { remember, ...(op.unsafe === undefined ? {} : { unsafe: op.unsafe }) });
        else kernl.grants.revokeDomain(summary.identity, op.domain, { remember });
      }
      await onconfirm(summary);
    } catch (reason) {
      error = explainOpenFailure(reason);
    } finally {
      busy = false;
    }
  }
</script>

<article class="summary" aria-live="polite">
  <header>
    <h3>{summary.title}</h3>
    <p class="shell-muted"><Publisher {kernl} applet={summary} /></p>
  </header>
  {#if summary.description}<p>{summary.description}</p>{/if}
  {#if accepts}<p class="shell-muted">Other applets can ask it to {accepts}.</p>{/if}
  {#if groups.length}
    <GrantList {groups} onchange={(row, group, on) => change(row.domain, group, on)} />
  {:else}
    <p class="shell-muted">This applet asks for nothing beyond the baseline.</p>
  {/if}
  {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
  <div class="shell-actions">
    <button type="button" class="shell-button primary" onclick={confirm} disabled={busy}>{action}</button>
    <button type="button" class="shell-button quiet" onclick={onback} disabled={busy}>Back</button>
    {#if storage}
      <label class="remember">
        <input type="checkbox" bind:checked={remember} onchange={() => storage && writeRemember(storage, remember)} />
        <span>Remember grants</span>
      </label>
    {/if}
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

  .summary p {
    margin: 0;
  }

  .remember {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-left: auto;
    font-size: 0.85rem;
    color: var(--ink-muted);
    cursor: pointer;
  }

  .remember input {
    margin: 0;
    accent-color: var(--accent);
  }
</style>
