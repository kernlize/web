<script lang="ts">
  import Publisher from './Publisher.svelte';
  import type { BootMode, InstalledApplet, ShellKernl } from './contract';
  import { observe } from './observe.svelte';
  import { acceptsWords, roleWords } from './store';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
    busy: boolean;
    onopen: (address: string) => void;
  }

  const { kernl, mode, busy, onopen }: Props = $props();
  const { defaults } = kernl.intents;

  const installed = observe(kernl.intents.installed$, kernl.intents.installed());
  $effect(() => installed.stop);

  let chosen = $state<Readonly<Record<string, string>>>(defaults.all());
  let sync = $state(defaults.sync);
  $effect(() => {
    const subscription = defaults.changes$.subscribe(() => (chosen = defaults.all()));
    return () => subscription.unsubscribe();
  });

  /** Every role an installed applet takes, with the applets that take it. */
  const roles = $derived.by(() => {
    const byRole = new Map<string, InstalledApplet[]>();
    for (const applet of installed.value) {
      for (const slug of new Set(applet.contracts.map((contract) => contract.slug))) byRole.set(slug, [...(byRole.get(slug) ?? []), applet]);
    }
    return [...byRole].sort(([a], [b]) => a.localeCompare(b));
  });
  const canSync = $derived(mode === 'live' && kernl.session !== null && !kernl.session.readOnly);

  function choose(archetype: string, value: string): void {
    void defaults.set(archetype, value === '' ? undefined : value);
  }

  function toggleSync(): void {
    defaults.setSync(sync);
  }
</script>

{#if installed.value.length === 0}
  <p class="shell-muted">Applets you open from the store stay here, so other applets can hand them work.</p>
{:else}
  {#if roles.length}
    <section class="shell-section">
      <h3>When an applet asks another to…</h3>
      <ul class="shell-list">
        {#each roles as [archetype, applets] (archetype)}
          <li class="shell-card role">
            <label for="role-{archetype}">{roleWords(archetype)}</label>
            <select id="role-{archetype}" class="shell-select" value={chosen[archetype] ?? ''} onchange={(event) => choose(archetype, event.currentTarget.value)}>
              <option value="">Ask each time</option>
              {#each applets as applet (applet.catalogId)}
                <option value={applet.catalogId}>{applet.title}</option>
              {/each}
            </select>
          </li>
        {/each}
      </ul>
      {#if canSync}
        <label class="shell-toggle">
          <span class="text">
            <span>Keep these choices with your account</span>
            <small>Your other devices use them too. Anyone can see which kinds of request you set a choice for.</small>
          </span>
          <input type="checkbox" bind:checked={sync} onchange={toggleSync} />
        </label>
      {/if}
    </section>
  {/if}

  <section class="shell-section">
    <h3>Installed</h3>
    <ul class="shell-list">
      {#each installed.value as applet (applet.catalogId)}
        {@const accepts = acceptsWords(applet.contracts.map((contract) => contract.convention))}
        <li class="shell-card row">
          <div>
            <h4>{applet.title}</h4>
            <p class="shell-muted">{#if accepts}Takes requests to {accepts}.{:else}<Publisher {kernl} {applet} />{/if}</p>
          </div>
          <div class="shell-actions">
            <button type="button" class="shell-button" onclick={() => onopen(applet.address)} disabled={busy}>Open</button>
            <button type="button" class="shell-button quiet" onclick={() => kernl.intents.uninstall(applet.catalogId)} aria-label="Remove {applet.title}">Remove</button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .row {
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  .role {
    grid-template-columns: 1fr minmax(10rem, auto);
    align-items: center;
  }
</style>
