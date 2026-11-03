<script lang="ts">
  import type { ShellKernl } from './contract';
  import { shortId } from './contract';
  import { domainLabel, formatBytes } from './domains';
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
  const baseline = kernl.grants.baselineDomains();
  let version = $state(0);
  const record = $derived.by(() => {
    void version;
    return kernl.grants.get(identity);
  });
  const granted = $derived(record?.domains ?? []);
  const quarantined = $derived(guardLog.quarantined.has(win.id));

  $effect(() => {
    const subscription = kernl.grants.changes$.subscribe(() => {
      version += 1;
    });
    return () => subscription.unsubscribe();
  });

  function toggle(domain: string, on: boolean): void {
    if (on) kernl.grants.allowDomain(identity, domain);
    else kernl.grants.revokeDomain(identity, domain);
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
    Grants are tied to this exact applet code. Changes apply to the running window at once.
  </p>
  <ul class="shell-list domains">
    {#each kernl.grants.availableDomains() as domain (domain)}
      {@const always = baseline.includes(domain)}
      <li class="shell-toggle">
        <label class="text" for="domain-{domain}">
          <span>{domainLabel(domain)}</span>
          <small>{always ? 'always on' : win.plan.summary.requires.includes(domain) ? 'the applet says it needs this' : win.plan.summary.optional.includes(domain) ? 'optional for this applet' : 'not requested'}</small>
        </label>
        <input id="domain-{domain}" type="checkbox" checked={always || granted.includes(domain)} disabled={always || record?.blocked} onchange={(event) => toggle(domain, event.currentTarget.checked)} />
      </li>
    {/each}
  </ul>
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

  .domains {
    gap: 0;
    margin-bottom: 1rem;
  }
</style>
