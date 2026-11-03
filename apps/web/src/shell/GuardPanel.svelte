<script lang="ts">
  import { GUARD_PROFILES, type GuardProfile } from '@kernl/guard';
  import type { ShellKernl } from './contract';
  import { describeGuardEvent, type GuardLog } from './guard-log.svelte';
  import { observe } from './observe.svelte';
  import Overlay from './Overlay.svelte';
  import type { WindowStore } from './window-store.svelte';

  interface Props {
    kernl: ShellKernl;
    guardLog: GuardLog;
    windows: WindowStore;
    onclose: () => void;
  }

  const { kernl, guardLog, windows, onclose }: Props = $props();
  const profile = observe(kernl.guard.profile$, kernl.guard.config.profile);
  $effect(() => profile.stop);
  const mitigations = $derived.by(() => {
    void profile.value;
    return kernl.guard.mitigations();
  });

  const PROVIDERS = { kehto: 'built into the toolkit', kernl: 'added by kernl', both: 'both' } as const;
  const PROFILE_HELP: Readonly<Record<GuardProfile, string>> = {
    strict: 'Every protection at its tightest. Where kernl starts.',
    balanced: 'Twice the budgets. For applets that legitimately do a lot.',
    relaxed: 'Three times the budgets. Nothing is switched off.',
  };

  const titleOf = (windowId: string): string => windows.get(windowId)?.plan.summary.title ?? windowId;
  const timeOf = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
</script>

<Overlay title="Guard" {onclose} wide>
  <section class="shell-section">
    <h3>Profile</h3>
    <fieldset class="profiles">
      <legend class="visually-hidden">Guard profile</legend>
      {#each GUARD_PROFILES as candidate (candidate)}
        <label class="profile" class:active={profile.value === candidate}>
          <input type="radio" name="guard-profile" value={candidate} checked={profile.value === candidate} onchange={() => kernl.guard.setProfile(candidate)} />
          <span class="name">{candidate}{candidate === 'strict' ? ' (default)' : ''}</span>
          <small>{PROFILE_HELP[candidate]}</small>
        </label>
      {/each}
    </fieldset>
  </section>
  <section class="shell-section">
    <h3>Protections</h3>
    <ul class="shell-list" data-testid="mitigations">
      {#each mitigations as mitigation (mitigation.id)}
        <li class="shell-card mitigation">
          <h4>{mitigation.title}</h4>
          <p>{mitigation.summary}</p>
          <div class="meta">
            {#if mitigation.limit}<span class="shell-badge">{mitigation.limit}</span>{/if}
            <span class="shell-badge on">{PROVIDERS[mitigation.provider]}</span>
          </div>
        </li>
      {/each}
    </ul>
  </section>
  <section class="shell-section">
    <h3>Recent events <span class="shell-muted count">({guardLog.total} this session)</span></h3>
    {#if guardLog.events.length}
      <ol class="shell-list log" aria-live="polite">
        {#each guardLog.events as event, index (`${event.at}-${index}`)}
          <li><time datetime={new Date(event.at).toISOString()}>{timeOf(event.at)}</time> {describeGuardEvent(event, titleOf(event.windowId))}</li>
        {/each}
      </ol>
    {:else}
      <p class="shell-muted">Nothing yet. The guard only speaks when it holds something back.</p>
    {/if}
  </section>
</Overlay>

<style>
  .profiles {
    border: 0;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.5rem;
  }

  @media (min-width: 640px) {
    .profiles {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .profile {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 0.6rem;
    align-items: center;
    padding: 0.75rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: 12px;
    cursor: pointer;
  }

  .profile.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .profile input {
    margin: 0;
    accent-color: var(--accent);
  }

  .profile .name {
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }

  .profile small {
    grid-column: 2;
    color: var(--ink-muted);
    font-size: 0.8rem;
  }

  .mitigation .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .count {
    font-size: 0.8rem;
    font-weight: 400;
  }

  .log {
    font-size: 0.88rem;
    gap: 0.3rem;
  }

  .log li {
    max-width: none;
  }

  time {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--ink-muted);
    margin-right: 0.4rem;
  }
</style>
