<script lang="ts">
  import type { ShellKernl } from './contract';
  import { shortId } from './contract';
  import { formatBytes, grantGroups, startingChoices, type GrantInput } from '@kernlize/ui-model';
  import GrantList from './GrantList.svelte';
  import type { GuardLog } from './guard-log.svelte';
  import Overlay from './Overlay.svelte';
  import type { ShellWindow } from './window-store.svelte';

  interface Props {
    kernl: ShellKernl;
    win: ShellWindow;
    guardLog: GuardLog;
    onclose: () => void;
  }

  const { kernl, win, guardLog, onclose }: Props = $props();
  const identity = $derived(win.plan.summary.identity);
  let version = $state(0);
  const record = $derived.by(() => {
    void version;
    return kernl.grants.get(identity);
  });
  const input = $derived<GrantInput>({
    requires: win.plan.summary.requires,
    optional: win.plan.summary.optional,
    baseline: kernl.grants.baselineDomains(),
    available: kernl.grants.availableDomains(),
    receives: win.plan.summary.manifest.archetypes.length > 0,
    others: kernl.grants.availableDomains(),
  });
  // Edits to a running applet's grants are as lasting as the start was: one run without remembering is edited without remembering.
  const groups = $derived(grantGroups(input, startingChoices(input, { granted: record?.domains ?? [], unsafe: record?.unsafe ?? [] }, false)));
  const quarantined = $derived(guardLog.quarantined.has(win.id));

  $effect(() => {
    const subscription = kernl.grants.changes$.subscribe(() => {
      version += 1;
    });
    return () => subscription.unsubscribe();
  });

  function toggle(domain: string, group: string, on: boolean): void {
    const remember = record?.temporary !== true;
    // An unsafe row is the person's override: off drops the exception and keeps the grant.
    if (group === 'unsafe') kernl.grants.allowDomain(identity, domain, { unsafe: on, remember });
    else if (on) kernl.grants.allowDomain(identity, domain, { remember });
    else kernl.grants.revokeDomain(identity, domain, { remember });
    version += 1;
  }

  function setBlocked(blocked: boolean): void {
    if (blocked) kernl.grants.block(identity);
    else kernl.grants.unblock(identity);
    version += 1;
  }

  function release(): void {
    kernl.guard.release(win.id);
    guardLog.released(win.id);
  }
</script>

<Overlay title="Grants for {win.plan.summary.title}" {onclose}>
  <p class="shell-muted lead">
    <span class="shell-badge">{shortId(identity.hash)}</span>
    Grants are tied to this exact applet code. Taking one back, or blocking the applet, stops the running window; one you add arrives the next time it opens.
  </p>
  <GrantList {groups} frozen={record?.blocked === true} onchange={(row, group, on) => toggle(row.domain, group, on)} />
  <section class="shell-section">
    <h3>Standing</h3>
    <dl class="shell-rows">
      <div><dt>Storage quota</dt><dd>{formatBytes(record?.stateQuotaBytes ?? 0)}</dd></div>
      <div><dt>Blocked</dt><dd>{record?.blocked ? 'yes' : 'no'}</dd></div>
      <div><dt>Guard events this session</dt><dd>{guardLog.forWindow(win.id).length}</dd></div>
    </dl>
    <div class="shell-actions">
      {#if record?.blocked}
        <button type="button" class="shell-button" onclick={() => setBlocked(false)}>Unblock applet</button>
      {:else}
        <button type="button" class="shell-button danger" onclick={() => setBlocked(true)}>Block applet</button>
      {/if}
      {#if quarantined}
        <button type="button" class="shell-button primary" onclick={release}>Release from quarantine</button>
      {/if}
    </div>
  </section>
</Overlay>

<style>
  .lead {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
  }
</style>
