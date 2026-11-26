<script lang="ts">
  import type { AppletStack, ShellKernl, StackMember } from './contract';
  import PersonName from './PersonName.svelte';
  import { abbreviate } from './contract';

  interface Props {
    kernl: ShellKernl;
    busy?: boolean;
    /** Open the applets this stack has ticked; the rest are installed, not opened. */
    onopenstack: (stack: AppletStack, chosen: readonly StackMember[]) => void;
    /** Open one applet of a stack on its own, through the review that single applets get. */
    onopenmember: (stack: AppletStack, member: StackMember) => void;
  }

  const { kernl, busy = false, onopenstack, onopenmember }: Props = $props();

  let stacks = $state.raw<readonly AppletStack[] | null>(null);
  let failed = $state(false);
  /** Stacks whose applet list is showing. */
  let open = $state<readonly string[]>([]);
  /** What the person ticked, where they changed it; a stack's entry points are ticked until they do. */
  let ticks = $state<Readonly<Record<string, readonly string[]>>>({});

  $effect(() => {
    const listing = kernl.stacks.stream().subscribe({
      next: (found) => (stacks = found),
      error: () => {
        failed = stacks === null || stacks.length === 0;
        stacks ??= [];
      },
      complete: () => (stacks ??= []),
    });
    return () => listing.unsubscribe();
  });

  function toggle(id: string): void {
    open = open.includes(id) ? open.filter((entry) => entry !== id) : [...open, id];
  }

  /** A member named the way its publisher named it: the manifest's `d`, or its key for a root applet. */
  const memberWords = (member: StackMember): string => (member.identifier === '' ? abbreviate(member.pubkey) : member.identifier);

  /** A stack's entry points, or every applet when its publisher marked none. */
  function defaultsOf(stack: AppletStack): readonly string[] {
    const marked = stack.members.filter((member) => member.start);
    return (marked.length > 0 ? marked : stack.members).map((member) => member.ref);
  }

  const chosenOf = (stack: AppletStack): readonly string[] => ticks[stack.id] ?? defaultsOf(stack);
  const isMarked = (stack: AppletStack): boolean => stack.members.some((member) => member.start);

  function tick(stack: AppletStack, member: StackMember, on: boolean): void {
    const chosen = chosenOf(stack);
    const next = on ? [...chosen, member.ref] : chosen.filter((ref) => ref !== member.ref);
    ticks = { ...ticks, [stack.id]: next };
  }

  function chosenMembers(stack: AppletStack): readonly StackMember[] {
    const chosen = chosenOf(stack);
    return stack.members.filter((member) => chosen.includes(member.ref));
  }

  /** What the stack's button says: how many windows it will open, or that it only installs. */
  function openWords(stack: AppletStack): string {
    const chosen = chosenOf(stack).length;
    if (chosen === 0) return 'Install only';
    if (chosen === stack.members.length) return 'Open all';
    return `Open ${chosen}`;
  }

  const stackWords = (stack: AppletStack): string => `${stack.members.length} ${stack.members.length === 1 ? 'applet' : 'applets'}`;
  const installWords = (stack: AppletStack): string => {
    const chosen = chosenOf(stack).length;
    if (chosen === 0) return `Install every applet in ${stack.title}`;
    return `Open ${chosen} of the ${stack.members.length} in ${stack.title}, installing the rest`;
  };
</script>

<div class="stacks">
  {#if stacks === null}
    <p class="shell-muted" role="status">Looking for stacks…</p>
  {:else if failed}
    <p class="shell-error" role="alert">The stacks could not be reached. You can still open an applet by its address.</p>
  {:else if stacks.length === 0}
    <p class="shell-muted" role="status">No stacks of applets have been published yet. A stack is a list someone published that names several applets at once.</p>
  {:else}
    <p class="shell-muted small">{stacks.length} {stacks.length === 1 ? 'stack' : 'stacks'} shared by the people who publish applets. Every applet in a stack is installed; the ones you tick are opened.</p>
    <ul class="shell-list" aria-label="Stacks">
      {#each stacks as stack (stack.id)}
        {@const shown = open.includes(stack.id)}
        <li class="shell-card stack">
          <div class="head">
            <div class="text">
              <h4>{stack.title}</h4>
              <p class="shell-muted">by <PersonName {kernl} pubkey={stack.publisher} /> · {stackWords(stack)}</p>
              {#if stack.description}<p class="description">{stack.description}</p>{/if}
            </div>
            <div class="shell-actions">
              <button type="button" class="shell-button primary" onclick={() => onopenstack(stack, chosenMembers(stack))} disabled={busy} aria-label={installWords(stack)}>
                {busy ? 'Opening…' : openWords(stack)}
              </button>
              <button type="button" class="shell-button quiet disclosure" aria-expanded={shown} aria-controls="members-{stack.id}" onclick={() => toggle(stack.id)}>
                <span class="caret" class:shown aria-hidden="true">▾</span> Show applets
              </button>
            </div>
          </div>
          {#if shown}
            <ul class="members" id="members-{stack.id}" aria-label="Applets in {stack.title}">
              {#each stack.members as member (member.ref)}
                {@const on = chosenOf(stack).includes(member.ref)}
                <li>
                  <label class="pick">
                    <input type="checkbox" checked={on} onchange={(event) => tick(stack, member, event.currentTarget.checked)} />
                    <span class="mono">{memberWords(member)}</span>
                    {#if member.start}<span class="entry">starts</span>{/if}
                  </label>
                  <button type="button" class="shell-button quiet open-one" onclick={() => onopenmember(stack, member)} disabled={busy} aria-label="Open {memberWords(member)} on its own">Open</button>
                </li>
              {/each}
            </ul>
            {#if isMarked(stack)}
              <p class="shell-muted small">Its publisher marked which applets to start with.</p>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .stack {
    display: block;
  }

  .head {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.75rem;
  }

  /* The arrow turns when the list is showing, so the button keeps its words. */
  .caret {
    display: inline-block;
    transition: transform 140ms var(--ease);
  }

  @media (prefers-reduced-motion: reduce) {
    .caret { transition: none; }
  }

  @media (max-width: 540px) {
    .head { grid-template-columns: 1fr; }
  }

  .caret.shown {
    transform: rotate(180deg);
  }

  .members {
    list-style: none;
    margin: 0.5rem 0 0;
    padding: 0;
    display: grid;
    gap: 0.2rem;
  }

  .members li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    border-top: 1px solid var(--line);
    padding: 0.25rem 0;
  }

  .pick {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    cursor: pointer;
  }

  .entry {
    font-size: 0.7rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--ink-muted);
  }

  .open-one {
    padding: 0.15rem 0.6rem;
    font-size: 0.8rem;
  }
</style>
