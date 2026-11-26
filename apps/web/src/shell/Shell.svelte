<script lang="ts">
  import './crypto-fallback';
  import { PasswordAccount } from 'applesauce-accounts/accounts';
  import { onMount } from 'svelte';
  import './shell.css';
  import { boot } from './boot';
  import AppletSettings from './AppletSettings.svelte';
  import ConsentDialog from './ConsentDialog.svelte';
  import { ConsentQueue } from './consent-queue.svelte';
  import { THROWAWAY_IDENTITY_TYPE } from '@kernlize/core';
  import type { Booted, Session } from './contract';
  import Desktop from './Desktop.svelte';
  import FirewallDialog from './FirewallDialog.svelte';
  import { FirewallQueue } from './firewall-queue.svelte';
  import { GuardLog } from './guard-log.svelte';
  import { TrafficLog } from './traffic-log.svelte';
  import HandlerChooser from './HandlerChooser.svelte';
  import { HandlerQueue } from './handler-queue.svelte';
  import { createHost, pickStorage, PREVIEW_STORAGE_PREFIX, scopedStorage, type AppletOpener } from './host';
  import Notices from './Notices.svelte';
  import { NoticeStore } from './notice-store.svelte';
  import ReplyChooser from './ReplyChooser.svelte';
  import { followShellTheme, shellTheme, type ThemeSignal } from './shell-theme';
  import { shellShortcut, type ShortcutRunner } from './shortcuts';
  import { ReplyQueue } from './reply-queue.svelte';
  import { SettingsQueue } from './settings-queue.svelte';
  import SignIn from './SignIn.svelte';
  import { WindowStore } from './window-store.svelte';
  import { createShellWindowManager } from './windows';

  // The preview keeps its own state: what it tries never follows the person into the live shell, and the reverse.
  const storage = new URLSearchParams(location.search).get('preview') === '1' ? scopedStorage(pickStorage(), PREVIEW_STORAGE_PREFIX) : pickStorage();
  const notices = new NoticeStore();
  const consent = new ConsentQueue();
  const firewall = new FirewallQueue();
  const windows = new WindowStore(createShellWindowManager(storage));
  const guardLog = new GuardLog();
  const traffic = new TrafficLog();
  const handlers = new HandlerQueue();
  const replies = new ReplyQueue();
  const settings = new SettingsQueue();
  const opener: AppletOpener = {};
  const shortcuts: ShortcutRunner = {};
  const host = createHost({ storage, consent, firewall, settings, notices, windows, handlers, replies, opener, shortcuts });

  let booted = $state.raw<Booted | null>(null);
  /** Why the shell could not start; there is no stand-in shell to fall back on. */
  let failure = $state<string | null>(null);
  let session = $state.raw<Session | null>(null);
  let desktop = $state<Desktop | null>(null);
  let root = $state<HTMLElement | null>(null);

  const phase = $derived(failure !== null ? 'failed' : booted === null ? 'boot' : session === null ? 'signin' : 'desktop');
  const consentTitle = $derived(consent.current ? windows.windows.find((win) => win.plan.summary.identity.hash === consent.current?.summary.applet.hash)?.plan.summary.title ?? 'An applet' : '');

  /** The core restores the active account; a locked local account waits for its password. */
  function restoreSession(result: Booted): void {
    const account = result.kernl.accounts.active;
    if (!account || (account instanceof PasswordAccount && !account.unlocked)) return;
    void result.kernl.login(account).catch((reason: unknown) => notices.push({ title: 'Could not sign in', body: String(reason), tone: 'warning' }));
  }

  /** The page's colours as the tokens hold them now; a fresh computed style, so a change is read, not remembered. */
  function readToken(token: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(token);
  }

  /** The header's theme switch and the system's preference: both change the palette under the applets. */
  const themeSignals: ThemeSignal[] = [
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return () => observer.disconnect();
    },
    (onChange) => {
      const queries = ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'].map((query) => matchMedia(query));
      for (const query of queries) query.addEventListener('change', onChange);
      return () => {
        for (const query of queries) query.removeEventListener('change', onChange);
      };
    },
  ];

  onMount(() => {
    const cleanups: (() => void)[] = [];
    const opened = shellTheme(readToken);
    void boot(host, new URLSearchParams(location.search), opened).then((result) => {
      booted = result;
      const { kernl } = result;
      // An applet is told the colours when it opens; this tells the ones already open when they change,
      // starting from the palette the shell was started with, so a switch made during boot is not lost (D-064).
      cleanups.push(followShellTheme(themeSignals, readToken, (theme) => kernl.theme.publish(theme), opened));
      cleanups.push(
        kernl.session$.subscribe((next) => {
          session = next;
        }).unsubscribe,
      );
      const events = kernl.guard.events$.subscribe((event) => {
        guardLog.push(event);
        traffic.guard(event);
      });
      cleanups.push(() => events.unsubscribe());
      const messages = kernl.traffic$.subscribe((message) => traffic.message(message));
      cleanups.push(() => messages.unsubscribe());
      const onMessage = (event: MessageEvent): void => kernl.handleWindowMessage(event);
      window.addEventListener('message', onMessage);
      cleanups.push(() => window.removeEventListener('message', onMessage));
      const onVisibility = (): void => windows.setPageVisible(document.visibilityState === 'visible');
      document.addEventListener('visibilitychange', onVisibility);
      cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));
      restoreSession(result);
      cleanups.push(() => kernl.destroy());
    }, (reason: unknown) => {
      failure = reason instanceof Error ? reason.message : String(reason);
    });
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      windows.manager.destroy();
    };
  });

  /** Close the topmost thing the shell has open; false when nothing was. */
  function dismiss(): boolean {
    if (consent.current) consent.answer(false);
    else if (firewall.current) firewall.answer(undefined);
    else if (replies.current) replies.answer(undefined);
    else if (settings.current) settings.close();
    else if (handlers.current) handlers.answer(undefined);
    else if (desktop?.closeTopOverlay()) root?.focus();
    else return false;
    return true;
  }

  /** Run one of the shell's own shortcuts; false when the key is not one, or had nothing to do. */
  function runShortcut(key: Parameters<typeof shellShortcut>[0]): boolean {
    const shortcut = shellShortcut(key);
    if (shortcut === 'dismiss') return dismiss();
    if (shortcut === 'launcher') desktop?.openLauncher();
    return shortcut !== undefined;
  }

  // A key an applet had no shortcut for comes back through the core, so these work while an applet has focus.
  // A dialog holds the keyboard while it is open, so a key an applet sends then was not typed by the person (D-054).
  shortcuts.run = (key) => {
    if (!(consent.current || firewall.current || replies.current || settings.current || handlers.current)) runShortcut(key);
  };

  function onKeydown(event: KeyboardEvent): void {
    if (runShortcut(event)) event.preventDefault();
  }

  async function signOut(): Promise<void> {
    for (const win of [...windows.windows, ...windows.panels]) windows.close(win.id);
    while (firewall.current) firewall.answer(undefined);
    while (handlers.current) handlers.answer(undefined);
    while (replies.current) replies.answer(undefined);
    while (settings.current) settings.close();
    await booted?.kernl.logout();
    // A throwaway identity is not offered again: its key goes with the session (D-044).
    for (const account of booted?.kernl.accounts.accounts ?? []) if (account.type === THROWAWAY_IDENTITY_TYPE) booted?.kernl.accounts.removeAccount(account);
  }
</script>

<div class="shell-root" tabindex="-1" bind:this={root} onkeydown={onKeydown} data-phase={phase}>
  {#if phase === 'boot'}
    <p class="booting shell-muted" role="status">Starting the shell…</p>
  {:else if phase === 'failed'}
    <div class="booting" role="alert"><p>The shell could not start.</p><p class="shell-muted">{failure}</p></div>
  {:else if booted && phase === 'signin'}
    <SignIn kernl={booted.kernl} mode={booted.mode} />
  {:else if booted && session}
    <Desktop bind:this={desktop} {booted} {session} {storage} {windows} {guardLog} {traffic} {opener} onproblem={(title, body) => notices.push({ title, body, tone: 'warning' })} onsignout={signOut} />
  {/if}

  {#if booted && session && handlers.current}
    {#key handlers.current}
      <HandlerChooser kernl={booted.kernl} prompt={handlers.current} onanswer={(choice) => handlers.answer(choice)} />
    {/key}
  {/if}

  {#if booted && session && replies.current}
    {#key replies.current}
      <ReplyChooser kernl={booted.kernl} prompt={replies.current} onanswer={(answer) => replies.answer(answer)} />
    {/key}
  {/if}

  {#if booted && session && settings.current}
    {#key settings.current}
      <AppletSettings prompt={settings.current} onclose={() => settings.close()} />
    {/key}
  {/if}

  {#if firewall.current && !consent.current}
    {#key firewall.current}
      <FirewallDialog prompt={firewall.current} waiting={firewall.queue.length - 1} onanswer={(choice) => firewall.answer(choice)} />
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

  div.booting {
    place-content: center;
    gap: 0.5rem;
    text-align: center;
  }

  div.booting p {
    margin: 0;
  }
</style>
