<script lang="ts">
  import type { AppletStack, StorageLike } from './contract';
  import type { GrantGroup, GrantRow } from '@kernlize/ui-model';
  import GrantList from './GrantList.svelte';
  import { readRemember, writeRemember } from './remember-grants';
  import { changeStackGrant, stackGrantGroups, type StackChoices, type StackGrantMember } from './stack-grants';

  interface Props {
    stack: AppletStack;
    /** The applets of the stack that could be resolved, in the stack's order. */
    members: readonly StackGrantMember[];
    choices: StackChoices;
    /** Where "Remember grants" is kept. */
    storage?: StorageLike;
    onback: () => void;
    /** Called with what the person confirmed, and whether to keep it. Throw to show an error. */
    onconfirm: (choices: StackChoices, remember: boolean) => Promise<void>;
  }

  const { stack, members, choices: start, storage, onback, onconfirm }: Props = $props();

  let choices = $state.raw<StackChoices>(start);
  let remember = $state(storage ? readRemember(storage) : true);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const groups = $derived(stackGrantGroups(members, choices));

  function change(domain: string, group: GrantGroup['id'], on: boolean): void {
    choices = changeStackGrant(members, choices, group, domain, on);
  }

  async function confirm(): Promise<void> {
    busy = true;
    error = null;
    try {
      await onconfirm(choices, remember);
    } catch (reason) {
      error = String(reason instanceof Error ? reason.message : reason);
    } finally {
      busy = false;
    }
  }

  const heading = $derived(`${members.length} ${members.length === 1 ? 'applet' : 'applets'} in ${stack.title}`);
</script>

<article class="summary" aria-live="polite">
  <header>
    <h3>{stack.title}</h3>
    <p class="shell-muted">{heading}: {members.map((member) => member.summary.title).join(', ')}.</p>
  </header>
  <p class="shell-muted">Each permission is asked for once for the whole stack.</p>
  {#if groups.length}
    <GrantList {groups} onchange={(row: GrantRow, group, on) => change(row.domain, group, on)} />
  {:else}
    <p class="shell-muted">These applets ask for nothing beyond the baseline.</p>
  {/if}
  {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
  <div class="shell-actions">
    <button type="button" class="shell-button primary" onclick={confirm} disabled={busy}>Open {members.length === 1 ? 'this applet' : `all ${members.length}`}</button>
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
</style>
