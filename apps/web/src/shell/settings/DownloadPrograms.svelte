<script lang="ts">
  import { DOWNLOAD_PROGRAMS, type DownloadConnection, type DownloadProgram } from '@kernlize/core';
  import type { ShellKernl } from '../contract';
  import {
    addFormName,
    connectionsIn,
    draftChanged,
    draftOf,
    labelOf,
    programBeside,
    programError,
    programStatus,
    PROGRAM_GROUPS,
    showsChooser,
    signInOf,
    noteWords,
    type ProgramDraft,
    type ProgramGroup,
  } from '../download-programs';
  import { observe } from '../observe.svelte';
  import ConnectionFields from './ConnectionFields.svelte';

  interface Props {
    kernl: ShellKernl;
  }

  interface Outcome {
    readonly tone: 'ok' | 'error';
    readonly text: string;
    readonly notes: readonly string[];
  }

  interface AddDraft {
    program: DownloadProgram;
    draft: ProgramDraft;
  }

  const { kernl }: Props = $props();
  const programs = kernl.downloads;
  const saved = observe(programs.state$, programs.state());
  $effect(() => saved.stop);

  const freshAdd = (group: ProgramGroup): AddDraft => ({ program: group.programs[0] as DownloadProgram, draft: draftOf(undefined) });
  let drafts = $state<Record<string, ProgramDraft>>(Object.fromEntries(programs.state().connections.map((connection) => [connection.id, draftOf(connection)])));
  let adds = $state<Record<string, AddDraft>>(Object.fromEntries(PROGRAM_GROUPS.map((group) => [group.id, freshAdd(group)])));
  let opened = $state<Record<string, boolean>>({});
  let outcomes = $state<Record<string, Outcome | undefined>>({});
  let versions = $state<Record<string, string | undefined>>({});
  let busy = $state<string | null>(null);

  const wordsFor = (notes: readonly string[]): string[] => notes.flatMap((note) => noteWords(note) ?? []);
  const failed = (reason: unknown): Outcome => ({ tone: 'error', text: programError(reason), notes: [] });

  /** Ask the program whether it is there, then keep what answered as a new connection, shown open as its own row. */
  async function add(group: ProgramGroup): Promise<void> {
    const { program, draft } = adds[group.id] as AddDraft;
    busy = group.id;
    outcomes[group.id] = undefined;
    try {
      const checked = await programs.check(program, signInOf(draft, DOWNLOAD_PROGRAMS[program].signIn));
      const connection = await programs.add(program, checked.signIn, labelOf(draft));
      drafts[connection.id] = draftOf(connection);
      versions[connection.id] = checked.probe.version;
      outcomes[connection.id] = { tone: 'ok', text: 'Saved.', notes: wordsFor(checked.notes) };
      adds[group.id] = freshAdd(group);
      opened[group.id] = false;
      opened[connection.id] = true;
    } catch (reason) {
      outcomes[group.id] = failed(reason);
    } finally {
      busy = null;
    }
  }

  /** Check the row's sign-in, a secret left empty being the one kept, then keep the change. */
  async function save(connection: DownloadConnection): Promise<void> {
    const draft = drafts[connection.id] as ProgramDraft;
    busy = connection.id;
    outcomes[connection.id] = undefined;
    try {
      const checked = await programs.check(connection.program, signInOf(draft, DOWNLOAD_PROGRAMS[connection.program].signIn), connection.id);
      const next = await programs.update(connection.id, { label: labelOf(draft), signIn: checked.signIn });
      drafts[connection.id] = draftOf(next);
      versions[connection.id] = checked.probe.version;
      outcomes[connection.id] = { tone: 'ok', text: 'Saved.', notes: wordsFor(checked.notes) };
    } catch (reason) {
      outcomes[connection.id] = failed(reason);
    } finally {
      busy = null;
    }
  }

  async function remove(connection: DownloadConnection): Promise<void> {
    try {
      await programs.remove(connection.id);
      for (const kept of [drafts, versions, outcomes, opened] as Record<string, unknown>[]) delete kept[connection.id];
    } catch (reason) {
      outcomes[connection.id] = failed(reason);
    }
  }

  function choose(group: ProgramGroup, id: string): void {
    if (group.routed) programs.chooseDefault(group.routed.domain, id);
  }
</script>

{#snippet said(outcome: Outcome | undefined)}
  {#if outcome}
    <p class={outcome.tone === 'error' ? 'shell-error' : 'small'} role={outcome.tone === 'error' ? 'alert' : 'status'}>{outcome.text}</p>
    {#each outcome.notes as note (note)}<p class="shell-muted small note">{note}</p>{/each}
  {/if}
{/snippet}

<section class="shell-section" aria-labelledby="download-programs-heading">
  <h3 id="download-programs-heading">Connected programs</h3>
  <p class="shell-muted small">Programs you run that applets can work through. Sign-ins are kept by {kernl.secrets.label}.</p>
  {#each PROGRAM_GROUPS as group (group.id)}
    {@const connections = connectionsIn(saved.value, group)}
    {@const adding = adds[group.id] as AddDraft}
    <div class="group" data-group={group.id}>
      <h4>{group.title}</h4>
      <p class="shell-muted small">{group.help}</p>
      {#if group.routed && showsChooser(saved.value, group)}
        {@const domain = group.routed.domain}
        <div class="choice" role="radiogroup" aria-labelledby="route-{group.id}">
          <span id="route-{group.id}" class="small legend">{group.routed.legend}</span>
          {#each connections as connection (connection.id)}
            <label><input type="radio" name="route-{group.id}" value={connection.id} checked={saved.value.defaults[domain] === connection.id} onchange={() => choose(group, connection.id)} /> {connection.label}</label>
          {/each}
        </div>
      {/if}
      <div class="cards">
        {#each connections as connection (connection.id)}
          {@const beside = programBeside(connection)}
          <details class="shell-card program" data-program={connection.program} data-connection={connection.id} data-label={connection.label} bind:open={opened[connection.id]}>
            <summary>
              <span class="name">{connection.label}{#if beside}<span class="shell-muted kind">{` · ${beside}`}</span>{/if}</span>
              <span class="shell-badge on">{programStatus(versions[connection.id], saved.value.locked.includes(connection.id))}</span>
            </summary>
            {#if drafts[connection.id]}
              <form aria-label={connection.label} onsubmit={(event) => (event.preventDefault(), void save(connection))}>
                <ConnectionFields program={connection.program} {connection} bind:draft={drafts[connection.id] as ProgramDraft} />
                <div class="shell-actions">
                  <button type="submit" class="shell-button primary" disabled={busy !== null || !draftChanged(drafts[connection.id] as ProgramDraft, connection)}>{busy === connection.id ? 'Checking…' : 'Save'}</button>
                  <button type="button" class="shell-button quiet" disabled={busy !== null} onclick={() => void remove(connection)} aria-label="Remove {connection.label}">Remove</button>
                </div>
                {@render said(outcomes[connection.id])}
              </form>
            {/if}
          </details>
        {/each}
        <details class="shell-card program add" bind:open={opened[group.id]}>
          <summary><span class="name">Add a connection</span></summary>
          <form aria-label={addFormName(group)} onsubmit={(event) => (event.preventDefault(), void add(group))}>
            {#if group.programs.length > 1}
              <label class="shell-field">
                <span>Program</span>
                <select class="shell-input" bind:value={adding.program}>
                  {#each group.programs as program (program)}<option value={program}>{DOWNLOAD_PROGRAMS[program].name}</option>{/each}
                </select>
              </label>
            {/if}
            <ConnectionFields program={adding.program} connection={undefined} bind:draft={adding.draft} />
            <div class="shell-actions">
              <button type="submit" class="shell-button primary" disabled={busy !== null || !draftChanged(adding.draft, undefined)}>{busy === group.id ? 'Checking…' : 'Save'}</button>
            </div>
            {@render said(outcomes[group.id])}
          </form>
        </details>
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
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    cursor: pointer;
    list-style: none;
  }

  /* A window on a phone hides title badges; a row's status stays. */
  .program summary :global(.shell-badge.on) {
    display: inline-block;
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
    align-items: center;
    gap: 0.25rem 1rem;
    font-size: 0.9rem;
  }

  .choice .legend {
    flex-basis: 100%;
    color: var(--ink-muted);
  }

  .choice label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .program .kind {
    font-weight: 400;
  }

  .add {
    border-style: dashed;
  }

  .add summary .name {
    font-weight: 500;
    color: var(--ink-muted);
  }

  .note {
    border-left: 2px solid var(--line-strong);
    padding-left: 0.6rem;
  }
</style>
