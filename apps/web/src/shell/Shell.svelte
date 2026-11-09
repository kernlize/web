<script lang="ts">
  import { PasswordAccount } from 'applesauce-accounts/accounts';
  import { onMount } from 'svelte';
  import './shell.css';
  import { boot } from './boot';
  import ConsentDialog from './ConsentDialog.svelte';
  import { ConsentQueue } from './consent-queue.svelte';
  import type { Booted, Session } from './contract';
  import Desktop from './Desktop.svelte';
  import { GuardLog } from './guard-log.svelte';
  import HandlerChooser from './HandlerChooser.svelte';
  import { HandlerQueue } from './handler-queue.svelte';
  import { createHost, pickStorage, type AppletOpener } from './host';
  import Notices from './Notices.svelte';
  import { NoticeStore } from './notice-store.svelte';
  import SignIn from './SignIn.svelte';
  import { WindowStore } from './window-store.svelte';

  const storage = pickStorage();
  const notices = new NoticeStore();
  const consent = new ConsentQueue();
  const windows = new WindowStore();
  const guardLog = new GuardLog();
  const handlers = new HandlerQueue();
  const opener: AppletOpener = {};
  const host = createHost({ storage, consent, notices, windows, handlers, opener });

  let booted = $state.raw<Booted | null>(null);
  let session = $state.raw<Session | null>(null);
  let desktop = $state<Desktop | null>(null);
  let root = $state<HTMLElement | null>(null);

  const phase = $derived(booted === null ? 'boot' : session === null ? 'signin' : 'desktop');
  const consentTitle = $derived(consent.current ? windows.windows.find((win) => win.plan.summary.identity.hash === consent.current?.summary.applet.hash)?.plan.summary.title ?? 'An applet' : '');

  /** The core restores the active account; a locked local account waits for its password. */
  function restoreSession(result: Booted): void {
    const account = result.kernl.accounts.active;
    if (!account || (account instanceof PasswordAccount && !account.unlocked)) return;
    void result.kernl.login(account).catch((reason: unknown) => notices.push({ title: 'Could not sign in', body: String(reason), tone: 'warning' }));
  }

  onMount(() => {
    const cleanups: (() => void)[] = [];
    void boot(host, new URLSearchParams(location.search)).then((result) => {
      booted = result;
      const { kernl } = result;
      cleanups.push(
        kernl.session$.subscribe((next) => {
          session = next;
        }).unsubscribe,
      );
      const events = kernl.guard.events$.subscribe((event) => guardLog.push(event));
      cleanups.push(() => events.unsubscribe());
      const onMessage = (event: MessageEvent): void => kernl.handleWindowMessage(event);
      window.addEventListener('message', onMessage);
      cleanups.push(() => window.removeEventListener('message', onMessage));
      const onVisibility = (): void => windows.setPageVisible(document.visibilityState === 'visible');
      document.addEventListener('visibilitychange', onVisibility);
      cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
      if (result.fallbackReason) notices.push({ title: 'Running the preview', body: result.fallbackReason, tone: 'warning' });
      restoreSession(result);
      cleanups.push(() => kernl.destroy());
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (consent.current) consent.answer(false);
      else if (handlers.current) handlers.answer(undefined);
      else if (desktop?.closeTopOverlay()) root?.focus();
      else return;
      event.preventDefault();
    } else if (event.altKey && event.key === '/') {
      desktop?.openLauncher();
      event.preventDefault();
    }
  }

  async function signOut(): Promise<void> {
    for (const win of [...windows.windows]) windows.close(win.id);
    while (handlers.current) handlers.answer(undefined);
    await booted?.kernl.logout();
  }
</script>

<div class="shell-root" tabindex="-1" bind:this={root} onkeydown={onKeydown} data-phase={phase}>
  {#if phase === 'boot'}
    <p class="booting shell-muted" role="status">Starting the shell…</p>
  {:else if booted && phase === 'signin'}
    <SignIn kernl={booted.kernl} mode={booted.mode} />
  {:else if booted && session}
    <Desktop bind:this={desktop} {booted} {session} {storage} {windows} {guardLog} {opener} onsignout={signOut} />
  {/if}

  {#if booted && session && handlers.current}
    {#key handlers.current}
      <HandlerChooser kernl={booted.kernl} prompt={handlers.current} onanswer={(choice) => handlers.answer(choice)} />
    {/key}
  {/if}

  {#if consent.current}
    <ConsentDialog prompt={consent.current} appletTitle={consentTitle} accountKey={session?.pubkey} onanswer={(allowed) => consent.answer(allowed)} />
  {/if}
  <Notices {notices} />
</div>

<style>
  .shell-root {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: var(--bg);
    color: var(--ink);
    overflow: hidden;
    outline: none;
  }

  .booting {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.85rem;
  }
</style>
