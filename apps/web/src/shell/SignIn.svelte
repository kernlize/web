<script lang="ts">
  import type { IAccount } from 'applesauce-accounts';
  import { ExtensionAccount, NostrConnectAccount, PasswordAccount, PrivateKeyAccount, ReadonlyAccount } from 'applesauce-accounts/accounts';
  import { NostrConnectSigner, PasswordSigner } from 'applesauce-signers';
  import { NEVER } from 'rxjs';
  import type { BootMode, ShellKernl } from './contract';
  import { abbreviate } from './contract';
  import { observe } from './observe.svelte';
  import PairingCode from './PairingCode.svelte';
  import { namesProtocol } from './vocabulary';

  const { kernl, mode }: { kernl: ShellKernl; mode: BootMode } = $props();

  type Method = 'remote' | 'readonly' | 'create' | 'unlock';
  const MIN_PASSWORD = 12;
  /** The scheme of a signer-issued pairing code; checked, never shown. */
  const REMOTE_SCHEME = 'bunker';

  const accounts = observe(kernl.accounts.accounts$, kernl.accounts.accounts);
  $effect(() => accounts.stop);

  let method = $state<Method | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let password = $state('');
  let confirm = $state('');
  let remoteCode = $state('');
  let pairingCode = $state('');
  let readonlyId = $state('');
  let unlocking = $state.raw<PasswordAccount | null>(null);
  let pairing: AbortController | null = null;

  const hasExtension = typeof window !== 'undefined' && 'nostr' in window;
  const kinds: Readonly<Record<string, string>> = { extension: 'browser extension', 'nostr-connect': 'remote signer', ncryptsec: 'local account', readonly: 'read-only', nsec: 'preview' };
  const labelOf = (account: IAccount): string => (account.metadata as { name?: string } | undefined)?.name ?? abbreviate(account.pubkey);

  function explain(reason: unknown): string {
    const message = reason instanceof Error ? reason.message : String(reason);
    const network = /pool|subscription|publish|relay|connect|timeout/i.test(message);
    if (network && mode === 'preview') return 'This needs the network. The preview runs offline.';
    if (network) return 'The signer did not answer. Check that it is open, then try again.';
    // Library errors can name the protocol; the user sees plain words (D-006).
    if (namesProtocol(message)) return 'That did not work. Check what you entered and try again.';
    return message;
  }

  async function attempt(work: () => Promise<void>): Promise<void> {
    busy = true;
    error = null;
    try {
      await work();
    } catch (reason) {
      error = explain(reason);
    } finally {
      busy = false;
    }
  }

  async function adopt(account: IAccount): Promise<void> {
    if (!kernl.accounts.getAccount(account.id)) kernl.accounts.addAccount(account);
    await kernl.login(account);
  }

  function choose(account: IAccount): void {
    if (account instanceof PasswordAccount && !account.unlocked) {
      unlocking = account;
      method = 'unlock';
      password = '';
      return;
    }
    void attempt(() => adopt(account));
  }

  const unlock = (): Promise<void> =>
    attempt(async () => {
      if (!unlocking) return;
      await unlocking.unlock(password);
      await adopt(unlocking);
    });

  const useExtension = (): Promise<void> => attempt(async () => adopt(await ExtensionAccount.fromExtension()));

  const connectRemote = (): Promise<void> =>
    attempt(async () => {
      const code = remoteCode.trim();
      if (!code.startsWith(`${REMOTE_SCHEME}://`)) throw new Error('That is not a pairing code. Copy the whole code from your signer app and paste it again.');
      const signer = await NostrConnectSigner.fromBunkerURI(code, {});
      await adopt(new NostrConnectAccount(await signer.getPublicKey(), signer));
    });

  const pair = (): Promise<void> =>
    attempt(async () => {
      pairing?.abort();
      const controller = new AbortController();
      pairing = controller;
      const tiers = kernl.relays.get();
      const relays = tiers.outbox.length ? tiers.outbox : tiers.discovery;
      // The preview has no network: its signer listens on nothing, so the code shows but nobody answers.
      const offline = mode === 'preview' ? { subscriptionMethod: () => NEVER, publishMethod: async () => undefined } : {};
      const signer = new NostrConnectSigner({ relays, ...offline });
      pairingCode = signer.getNostrConnectURI({ name: 'kernl', url: location.origin });
      try {
        await signer.waitForSigner(controller.signal);
      } catch (reason) {
        // Back was pressed: the person stopped waiting, which is not an error.
        if (controller.signal.aborted) return;
        throw reason;
      }
      await adopt(new NostrConnectAccount(await signer.getPublicKey(), signer));
    });

  const useReadonly = (): Promise<void> => attempt(() => adopt(ReadonlyAccount.fromPubkey(readonlyId.trim())));

  const create = (): Promise<void> =>
    attempt(async () => {
      if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
      if (password !== confirm) throw new Error('The two passwords differ.');
      const signer = new PasswordSigner();
      signer.key = crypto.getRandomValues(new Uint8Array(32));
      await signer.setPassword(password);
      await adopt(new PasswordAccount(await signer.getPublicKey(), signer));
    });

  const tryPreview = (): Promise<void> =>
    attempt(async () => {
      const account = PrivateKeyAccount.generateNew<{ name: string }>();
      account.metadata = { name: 'Preview account' };
      await adopt(account);
    });

  function pick(next: Method): void {
    method = next;
    error = null;
    password = '';
    confirm = '';
  }

  function cancel(): void {
    pairing?.abort();
    pairingCode = '';
    method = null;
    error = null;
  }

  const remembered = $derived(accounts.value.filter((account) => account.type !== 'nsec'));
</script>

<section class="signin" aria-labelledby="signin-title">
  <div class="card">
    <p class="label">kernl</p>
    <h2 id="signin-title">Who is at the keyboard?</h2>
    <p class="shell-muted lede">Your account stays with you. Applets only ever see what you grant, for as long as you grant it.</p>

    {#if mode === 'preview'}
      <div class="preview">
        <button type="button" class="shell-button primary" onclick={tryPreview} disabled={busy}>Try the preview</button>
        <p class="shell-muted">A throwaway account that lives only in this tab. Nothing leaves your browser.</p>
      </div>
    {/if}

    {#if remembered.length}
      <section class="shell-section">
        <h3>Remembered accounts</h3>
        <ul class="shell-list">
          {#each remembered as account (account.id)}
            <li class="shell-card row">
              <div>
                <h4>{labelOf(account)}</h4>
                <p>{kinds[account.type] ?? account.type}</p>
              </div>
              <div class="shell-actions">
                <button type="button" class="shell-button" onclick={() => choose(account)} disabled={busy}>Sign in</button>
                <button type="button" class="shell-button quiet" onclick={() => kernl.accounts.removeAccount(account)} aria-label="Forget {labelOf(account)}">Forget</button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if method === null}
      <section class="shell-section">
        <h3>{mode === 'preview' || remembered.length ? 'Sign in another way' : 'Sign in'}</h3>
        <ul class="shell-list">
          {#if hasExtension}
            <li class="shell-card row">
              <div><h4>Use a browser extension</h4><p>A signing extension in this browser holds your key. The shell asks it to sign; it never sees the key.</p></div>
              <button type="button" class="shell-button" onclick={useExtension} disabled={busy}>Use</button>
            </li>
          {/if}
          <li class="shell-card row">
            <div><h4>Connect a remote signer</h4><p>Your key stays in a signer app on another device. The shell sends it requests.</p></div>
            <button type="button" class="shell-button" onclick={() => pick('remote')} disabled={busy}>Connect</button>
          </li>
          <li class="shell-card row">
            <div><h4>Read-only</h4><p>Look around as any account. Applets see the identity; nothing can be signed.</p></div>
            <button type="button" class="shell-button" onclick={() => pick('readonly')} disabled={busy}>Choose</button>
          </li>
          <li class="shell-card row">
            <div><h4>Create a local account</h4><p>A new key, encrypted with a password you choose and kept in this browser.</p></div>
            <button type="button" class="shell-button" onclick={() => pick('create')} disabled={busy}>Create</button>
          </li>
        </ul>
      </section>
    {:else}
      <section class="shell-section method">
        {#if method === 'unlock' && unlocking}
          <h3>Unlock {labelOf(unlocking)}</h3>
          <form onsubmit={(event) => (event.preventDefault(), unlock())}>
            <label class="shell-field"><span>Password</span><input class="shell-input" type="password" bind:value={password} autocomplete="current-password" /></label>
            <div class="shell-actions"><button type="submit" class="shell-button primary" disabled={busy || !password}>Unlock</button><button type="button" class="shell-button quiet" onclick={cancel}>Back</button></div>
          </form>
        {:else if method === 'remote'}
          <h3>Connect a remote signer</h3>
          <form onsubmit={(event) => (event.preventDefault(), connectRemote())}>
            <label class="shell-field"><span>Pairing code from your signer app</span><input class="shell-input mono" type="text" bind:value={remoteCode} placeholder="paste the code your signer shows" autocomplete="off" spellcheck="false" /></label>
            <div class="shell-actions">
              <button type="submit" class="shell-button primary" disabled={busy || !remoteCode.trim()}>Connect</button>
              <button type="button" class="shell-button" onclick={pair} disabled={busy}>Or pair from the signer</button>
              <button type="button" class="shell-button quiet" onclick={cancel}>Back</button>
            </div>
          </form>
          {#if pairingCode}
            <PairingCode code={pairingCode} />
            <p class="shell-muted">{mode === 'preview' ? 'The preview runs offline, so no signer can answer here.' : 'Waiting for the signer to accept…'}</p>
          {/if}
        {:else if method === 'readonly'}
          <h3>Read-only</h3>
          <form onsubmit={(event) => (event.preventDefault(), useReadonly())}>
            <label class="shell-field"><span>Account id</span><input class="shell-input mono" type="text" bind:value={readonlyId} autocomplete="off" spellcheck="false" /></label>
            <div class="shell-actions"><button type="submit" class="shell-button primary" disabled={busy || !readonlyId.trim()}>Continue</button><button type="button" class="shell-button quiet" onclick={cancel}>Back</button></div>
          </form>
        {:else if method === 'create'}
          <h3>Create a local account</h3>
          <form onsubmit={(event) => (event.preventDefault(), create())}>
            <label class="shell-field"><span>Password (at least {MIN_PASSWORD} characters)</span><input class="shell-input" type="password" bind:value={password} autocomplete="new-password" /></label>
            <label class="shell-field"><span>Repeat the password</span><input class="shell-input" type="password" bind:value={confirm} autocomplete="new-password" /></label>
            <p class="shell-muted">The key is generated here and encrypted with this password. Lose the password and the account is gone; nobody can reset it.</p>
            <div class="shell-actions"><button type="submit" class="shell-button primary" disabled={busy || !password || !confirm}>Create and sign in</button><button type="button" class="shell-button quiet" onclick={cancel}>Back</button></div>
          </form>
        {/if}
      </section>
    {/if}
    {#if error}<p class="shell-error" role="alert">{error}</p>{/if}
  </div>
</section>

<style>
  .signin {
    min-height: 100%;
    display: grid;
    place-items: center;
    padding: 2rem 1rem;
    overflow: auto;
  }

  .card {
    width: min(100%, 34rem);
    display: grid;
    gap: 1.25rem;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: clamp(1.25rem, 4vw, 2.25rem);
  }

  .label {
    margin: 0;
  }

  h2 {
    margin: 0;
    font-size: clamp(1.6rem, 4vw, 2.2rem);
  }

  .lede {
    margin: 0;
  }

  .preview {
    display: grid;
    gap: 0.5rem;
    padding: 1rem;
    border: 1px dashed var(--line-strong);
    border-radius: 12px;
  }

  .preview p {
    margin: 0;
    font-size: 0.9rem;
  }

  .row {
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  .method form {
    display: grid;
    gap: 0.75rem;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }
</style>
