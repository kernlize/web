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
        <li class="shell-toggle">
          <label class="text" for="grant-{row.domain}">
            <span>{row.label} <span class="shell-contract" data-contract>{contractName(row.domain)}</span></span>
            {#if row.note}<small>{row.note}</small>{/if}
          </label>
          <input id="grant-{row.domain}" type="checkbox" checked={row.on} disabled={row.locked || frozen} onchange={(event) => onchange(row, group.id, event.currentTarget.checked)} />
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
</style>
