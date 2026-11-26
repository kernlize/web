<script lang="ts">
  import Publisher from './Publisher.svelte';
  import type { AppletPointer, AppletStack, AppletSummary, BootMode, CatalogEntry, MountPlan, ShellKernl, StackMember, StorageLike } from './contract';
  import AppletReview from './AppletReview.svelte';
  import InstalledApplets from './InstalledApplets.svelte';
  import { explainOpenFailure } from './launcher-reasons';
  import { forgetRecent, readRecent, rememberRecent, type RecentApplet } from './recent';
  import StackBrowser from './StackBrowser.svelte';
  import { stackMembers, startingStackChoices, type StackChoices, type StackGrantMember } from './stack-grants';
  import type { GrantChoices } from '@kernlize/ui-model';
  import { installStack, missedWords, openStack, resolveStack } from './stack-opening';
  import StackReview from './StackReview.svelte';
  import StoreBrowser from './StoreBrowser.svelte';

  interface Props {
    kernl: ShellKernl;
    mode: BootMode;
    storage: StorageLike;
    initialAddress?: string;
    onopen: (plan: MountPlan) => void;
    onopenmember: (member: StackGrantMember, choice: GrantChoices, remember: boolean) => Promise<void>;
    onopenall: (problem: string | null) => void;
  }

  const { kernl, mode, storage, initialAddress = '', onopen, onopenmember, onopenall }: Props = $props();

  type Tab = 'store' | 'stacks' | 'installed' | 'recent';

  // The address the shell resolves stays in state; the search field is cleared once an applet is
  // found, so a raw address is never echoed back in the summary (D-006).
  let tab = $state<Tab>('store');
  let review = $state.raw<{ summary: AppletSummary; address: string } | null>(null);
  // A stack waiting for the person's answer: its applets are resolved and installed, none is planned yet.
  let pending = $state.raw<{ stack: AppletStack; members: readonly StackGrantMember[]; missed: number } | null>(null);
  let info = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let recent = $state.raw<readonly RecentApplet[]>(readRecent(storage));

  /** Look up one applet and put it in front of the person, as the review that single applets get. */
  async function look(pointer: AppletPointer, shown: string): Promise<void> {
    info = null;
    error = null;
    busy = true;
    try {
      const summary = await kernl.resolve(pointer);
      review = { summary, address: pointer.kind === 'event' ? shown : summary.address };
    } catch (reason) {
      error = explainOpenFailure(reason);
    } finally {
      busy = false;
    }
  }

  async function resolve(target: string): Promise<void> {
    const address = target.trim();
    try {
      await look(kernl.decodePointer(address), address);
    } catch (reason) {
      error = explainOpenFailure(reason);
    }
  }

  async function run(found: AppletSummary, address: string): Promise<void> {
    const plan = await kernl.plan(found);
    recent = rememberRecent(storage, { address, title: found.title, publisher: found.publisher });
    onopen(plan);
  }

  /**
   * Install every applet a stack names, then ask for the permissions of the ones
   * the person ticked to open. An applet installed but not opened runs later, when
   * another applet asks it for something.
   */
  async function pickStack(stack: AppletStack, chosen: readonly StackMember[]): Promise<void> {
    review = null;
    info = null;
    error = null;
    busy = true;
    try {
      const { found, missed } = await resolveStack(kernl, stack);
      if (found.length === 0) {
        error = missedWords({ opened: 0, missed }, stack) ?? null;
        return;
      }
      installStack(kernl, found);
      const ticked = found.filter((entry) => chosen.some((member) => member.catalogId === entry.manifest.catalogId));
      if (ticked.length === 0) {
        info = `${found.length} ${found.length === 1 ? 'applet is' : 'applets are'} installed. Open one from Yours, or let another applet ask for it.`;
        error = missed > 0 ? `${missed} of ${stack.members.length} applets could not be installed.` : null;
        return;
      }
      pending = { stack, members: stackMembers(kernl, ticked), missed };
    } catch (reason) {
      error = explainOpenFailure(reason);
    } finally {
      busy = false;
    }
  }

  /** Open one applet of a stack on its own, through the review a single applet gets. */
  async function openMember(_stack: AppletStack, member: StackMember): Promise<void> {
    await look({ kind: 'address', pubkey: member.pubkey, identifier: member.identifier, eventKind: member.eventKind, relays: member.relays }, member.ref);
  }

  /** The person answered for the stack: write its grants and open the ticked applets in turn. */
  async function openPending(choices: StackChoices, remember: boolean): Promise<void> {
    const stack = pending;
    if (!stack) return;
    const opening = await openStack(stack.members, (member, index) => onopenmember(member, choices[index]!, remember));
    pending = null;
    error = missedWords({ opened: opening.opened, missed: opening.missed + stack.missed }, stack.stack) ?? null;
    if (opening.opened > 0) onopenall(error);
  }

  $effect(() => {
    if (initialAddress) void resolve(initialAddress);
  });
</script>

<div class="launcher">
  {#if pending}
    <StackReview
      stack={pending.stack}
      members={pending.members}
      choices={startingStackChoices(pending.members)}
      {storage}
      onback={() => (pending = null)}
      onconfirm={openPending}
    />
  {:else if review}
    {@const { summary, address } = review}
    {#key review}
      <AppletReview {kernl} {summary} {storage} action="Run" onback={() => (review = null)} onconfirm={(found) => run(found, address)} />
    {/key}
  {:else}
    <div class="tabs" role="tablist" aria-label="Applets">
      <button type="button" role="tab" aria-selected={tab === 'store'} class:on={tab === 'store'} onclick={() => (tab = 'store')}>Store</button>
      <button type="button" role="tab" aria-selected={tab === 'stacks'} class:on={tab === 'stacks'} onclick={() => (tab = 'stacks')}>Stacks</button>
      <button type="button" role="tab" aria-selected={tab === 'installed'} class:on={tab === 'installed'} onclick={() => (tab = 'installed')}>Yours</button>
      {#if recent.length}
        <button type="button" role="tab" aria-selected={tab === 'recent'} class:on={tab === 'recent'} onclick={() => (tab = 'recent')}>Recent</button>
      {/if}
    </div>
    {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
    {#if info}<p class="shell-muted" role="status">{info}</p>{/if}

    {#if tab === 'store'}
      {#if mode === 'preview'}<p class="shell-muted" role="note">The preview never reaches the network, so the store shows its three sample applets. Sign in to the live shell to browse every published applet.</p>{/if}
      <StoreBrowser {kernl} {busy} onpick={(entry: CatalogEntry) => resolve(entry.address)} onaddress={resolve} />
    {:else if tab === 'stacks'}
      <StackBrowser {kernl} {busy} onopenstack={pickStack} onopenmember={openMember} />
    {:else if tab === 'installed'}
      <InstalledApplets {kernl} {mode} {busy} onopen={resolve} />
    {:else}
      <ul class="shell-list">
        {#each recent as entry (entry.address)}
          <li class="shell-card row">
            <div>
              <h4>{entry.title}</h4>
              <p class="shell-muted"><Publisher {kernl} applet={entry} /></p>
            </div>
            <div class="shell-actions">
              <button type="button" class="shell-button" onclick={() => resolve(entry.address)} disabled={busy}>Open</button>
              <button type="button" class="shell-button quiet" onclick={() => (recent = forgetRecent(storage, entry.address))} aria-label="Forget {entry.title}">Forget</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .tabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: 1px solid var(--line);
    margin-bottom: 1rem;
  }

  .tabs button {
    font: inherit;
    background: transparent;
    color: var(--ink-muted);
    border: 0;
    border-bottom: 2px solid transparent;
    padding: 0.4rem 0.75rem;
    cursor: pointer;
  }

  .tabs button.on {
    color: var(--ink);
    border-bottom-color: var(--accent);
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .row {
    grid-template-columns: 1fr auto;
    align-items: center;
  }
</style>
