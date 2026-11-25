<script lang="ts">
  import { contractName, type GrantGroup, type GrantRow } from '@kernlize/ui-model';

  interface Props {
    groups: readonly GrantGroup[];
    /** A switch was flipped. `group` says which kind of row it was: an unsafe one is the person's override. */
    onchange: (row: GrantRow, group: GrantGroup['id'], on: boolean) => void;
    /** Every switch is fixed, as for an applet that is blocked. */
    frozen?: boolean;
  }

  const { groups, onchange, frozen = false }: Props = $props();
</script>

<div class="grants">
  {#each groups as group (group.id)}
    <ul class="shell-list rows" role="group" aria-label={group.label} data-group={group.id}>
      <li class="caption" class:unsafe={group.id === 'unsafe'} aria-hidden="true">{group.label}</li>
      {#each group.rows as row (row.domain)}
        <li class="shell-toggle" class:listed={row.applets}>
          <div class="text">
            <label for="grant-{group.id}-{row.domain}">
              <span>{row.label} <span class="shell-contract" data-contract>{contractName(row.domain)}</span></span>
              {#if row.note}<small>{row.note}</small>{/if}
            </label>
            {#if row.applets}
              <ul class="applets" data-applets aria-label="Asked for by">
                {#each row.applets as applet}
                  <li>{applet.title}{#if applet.required}{' '}<span class="needed">needed</span>{/if}</li>
                {/each}
              </ul>
            {/if}
          </div>
          <input id="grant-{group.id}-{row.domain}" type="checkbox" checked={row.on} indeterminate={row.mixed === true} disabled={row.locked || frozen} onchange={(event) => onchange(row, group.id, event.currentTarget.checked)} />
        </li>
      {/each}
    </ul>
  {/each}
</div>

<style>
  .rows {
    gap: 0;
  }

  /* A label for what follows, in the list's own flow: small and quiet, not a heading with a break above it. */
  .caption {
    padding: 0.7rem 0 0.1rem;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }

  .grants .rows:first-child .caption {
    padding-top: 0.2rem;
  }

  .caption.unsafe {
    color: var(--accent);
  }

  /* A row that names who asked sits with its list, so the switch stays level with the label. */
  .shell-toggle.listed {
    align-items: flex-start;
  }

  .listed input {
    margin-top: 0.2rem;
  }

  .text label {
    display: grid;
    gap: 0.1rem;
    cursor: pointer;
  }

  /* The applets that asked for a row: one per line, quieter than the note. */
  .applets {
    margin: 0.15rem 0 0;
    padding-left: 1rem;
    color: var(--ink-muted);
    font-size: 0.8rem;
  }

  .applets .needed {
    color: var(--ink-muted);
    font-style: italic;
  }
</style>
