<script lang="ts">
  import { DOWNLOAD_PROGRAMS, type DownloadProgram, type TorrentProgram } from '@kernlize/core';
  import type { ShellKernl } from '../contract';
  import { draftChanged, draftOf, fieldLabel, hasSecret, isSecretField, noteWords, programError, programStatus, PROGRAM_GROUPS, signInOf, type ProgramDraft } from '../download-programs';
  import { observe } from '../observe.svelte';

  interface Props {
    kernl: ShellKernl;
  }

  interface Outcome {
    readonly tone: 'ok' | 'error';
    readonly text: string;
    readonly notes: readonly string[];
  }

  const { kernl }: Props = $props();
  const programs = kernl.downloads;
  const saved = observe(programs.state$, programs.state());
  $effect(() => saved.stop);

  const TORRENT_PROGRAMS: readonly TorrentProgram[] = ['transmission', 'utorrent'];
  const ids = Object.keys(DOWNLOAD_PROGRAMS) as DownloadProgram[];
  let drafts = $state<Record<DownloadProgram, ProgramDraft>>(Object.fromEntries(ids.map((id) => [id, draftOf(programs.state().connections[id])])) as Record<DownloadProgram, ProgramDraft>);
  let outcomes = $state<Partial<Record<DownloadProgram, Outcome>>>({});
  let versions = $state<Partial<Record<DownloadProgram, string>>>({});
  let busy = $state<DownloadProgram | null>(null);

  const bothTorrent = $derived(TORRENT_PROGRAMS.every((id) => saved.value.connections[id] !== undefined));
  const wordsFor = (notes: readonly string[]): string[] => notes.flatMap((note) => noteWords(note) ?? []);

  /** Ask the program whether it is there, working out http or https when the address has neither, then keep what answered. */
  async function connect(id: DownloadProgram): Promise<void> {
    busy = id;
    outcomes[id] = undefined;
    try {
      const checked = await programs.check(id, signInOf(drafts[id], DOWNLOAD_PROGRAMS[id].signIn));
      await programs.save(id, checked.signIn);
      versions[id] = checked.probe.version;
      drafts[id] = draftOf(programs.state().connections[id]);
      outcomes[id] = { tone: 'ok', text: 'Saved.', notes: wordsFor(checked.notes) };
    } catch (reason) {
      outcomes[id] = { tone: 'error', text: programError(reason), notes: [] };
    } finally {
      busy = null;
    }
  }

  async function remove(id: DownloadProgram): Promise<void> {
    try {
      await programs.remove(id);
      versions[id] = undefined;
      drafts[id] = draftOf(undefined);
      outcomes[id] = undefined;
    } catch (reason) {
      outcomes[id] = { tone: 'error', text: programError(reason), notes: [] };
    }
  }
</script>

<section class="shell-section" aria-labelledby="download-programs-heading">
  <h3 id="download-programs-heading">Download programs</h3>
  <p class="shell-muted small">Programs you run that applets can download through. Sign-ins are kept by {kernl.secrets.label}.</p>
  {#each PROGRAM_GROUPS as group (group.id)}
    <div class="group">
      <h4>{group.title}</h4>
      <p class="shell-muted small">{group.help}</p>
      {#if group.id === 'peers' && bothTorrent}
        <fieldset class="choice">
          <legend class="small">Applets use</legend>
          {#each TORRENT_PROGRAMS as id (id)}
            <label><input type="radio" name="torrent-program" value={id} checked={saved.value.torrentProgram === id} onchange={() => programs.chooseTorrent(id)} /> {DOWNLOAD_PROGRAMS[id].name}</label>
          {/each}
        </fieldset>
      {/if}
      <div class="cards">
        {#each group.programs as id (id)}
          {@const info = DOWNLOAD_PROGRAMS[id]}
          {@const connection = saved.value.connections[id]}
          {@const outcome = outcomes[id]}
          <details class="shell-card program" data-program={id}>
            <summary>
              <span class="name">{info.name}</span>
              <span class="shell-badge" class:on={connection !== undefined}>{programStatus(connection, versions[id], saved.value.locked.includes(id))}</span>
            </summary>
            <form aria-label={info.name} onsubmit={(event) => (event.preventDefault(), void connect(id))}>
            <label class="shell-field">
              <span>Address</span>
              <input class="shell-input mono" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={drafts[id].url} placeholder={info.example} />
            </label>
            {#each info.signIn as field (field)}
              <label class="shell-field">
                <span>{fieldLabel(field)}</span>
                <input
                  class="shell-input mono"
                  type={isSecretField(field) ? 'password' : 'text'}
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck="false"
                  bind:value={drafts[id][field]}
                  placeholder={hasSecret(connection, field) ? 'Saved' : ''}
                />
              </label>
            {/each}
            <div class="shell-actions">
              <button type="submit" class="shell-button primary" disabled={busy !== null || !draftChanged(drafts[id], connection)}>{busy === id ? 'Checking…' : 'Save'}</button>
              {#if connection}<button type="button" class="shell-button quiet" disabled={busy !== null} onclick={() => void remove(id)} aria-label="Remove {info.name}">Remove</button>{/if}
            </div>
            {#if outcome}
              <p class={outcome.tone === 'error' ? 'shell-error' : 'small'} role={outcome.tone === 'error' ? 'alert' : 'status'}>{outcome.text}</p>
              {#each outcome.notes as note (note)}<p class="shell-muted small note">{note}</p>{/each}
            {/if}
            </form>
          </details>
        {/each}
      </div>
    </div>
  {/each}
</section>

<style>
  .small {
    font-size: 0.85rem;
    margin: 0;
  }

  .group {
    display: grid;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .group h4 {
    margin: 0;
  }

  .cards {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: 1fr;
  }

  .program summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    list-style: none;
  }

  .program summary::-webkit-details-marker {
    display: none;
  }

  .program .name {
    font-weight: 600;
  }

  .program form {
    display: grid;
    gap: 0.6rem;
    margin-top: 0.75rem;
  }

  .choice {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    border: 0;
    padding: 0;
    margin: 0;
  }

  .choice legend {
    padding: 0;
    color: var(--ink-muted);
  }

  .note {
    border-left: 2px solid var(--line-strong);
    padding-left: 0.6rem;
  }
</style>
