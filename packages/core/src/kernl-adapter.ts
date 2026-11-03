import type { AccountManager } from 'applesauce-accounts';
import { verifyEvent } from 'applesauce-core/helpers';
import type { CapabilityHooks, NappletMessage, NappletRevocation, ShellAdapter, UnroutedMessageInfo } from '@kehto/shell';
import type { ServiceRegistry } from '@kehto/runtime';
import type { RelayTier, RelayTiers } from './types.js';
import { createAuthHooks } from './applesauce/auth-hooks.js';
import type { SigningConsent } from './consent/handler.js';
import { createRelayPoolHooks, type ApplesaucePool } from './applesauce/relay-hooks.js';

const TIERS: readonly string[] = ['discovery', 'apps', 'outbox', 'super'];

/** What the adapter needs from the rest of the shell. */
export interface ShellAdapterDeps {
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  readonly accounts: AccountManager;
  /** Gates every signature made for an applet window; see `createSigningConsent`. */
  readonly consent: SigningConsent;
  readonly services: ServiceRegistry;
  readonly resolveEnvironment: NonNullable<CapabilityHooks['resolveEnvironment']>;
  readonly onNappletRevoked: (revocation: NappletRevocation) => void;
  readonly onNappletMessage: (windowId: string, message: NappletMessage) => void;
  readonly onUnroutedMessage?: (info: UnroutedMessageInfo) => void;
}

function isTier(tier: string): tier is RelayTier {
  return TIERS.includes(tier);
}

/**
 * Build kehto's `ShellAdapter` from kernl's parts.
 *
 * Choices kehto left open, decided here: windows are created by the host
 * through intents, not by applets (`createWindow` returns null); hotkeys are
 * not forwarded; there is no worker relay, the applesauce pool is the only
 * event source; every signature made for an applet window passes the consent
 * gate; update behaviour is `banner`; event signatures are verified by
 * applesauce; and every applet's environment is narrowed by the grants layer.
 *
 * @param deps - Pool, tiers, accounts, services and the shell's hooks.
 * @returns The adapter for `createShellBridge`.
 * @example
 * ```ts
 * const bridge = createShellBridge(createShellAdapter(deps));
 * ```
 */
export function createShellAdapter(deps: ShellAdapterDeps): ShellAdapter {
  const { tiers } = deps;
  return {
    relayPool: createRelayPoolHooks(deps.pool, tiers),
    relayConfig: {
      addRelay(tier, url) {
        if (isTier(tier)) tiers.add(tier, url);
      },
      removeRelay(tier, url) {
        if (isTier(tier)) tiers.remove(tier, url);
      },
      getRelayConfig() {
        const config = tiers.get();
        return { discovery: [...config.discovery], super: [...config.super], outbox: [...config.outbox] };
      },
      getNip66Suggestions: () => null,
    },
    windowManager: { createWindow: () => null },
    auth: createAuthHooks(deps.accounts, deps.consent),
    config: { getNappUpdateBehavior: () => 'banner' },
    hotkeys: { executeHotkeyFromForward: () => undefined },
    workerRelay: { getWorkerRelay: () => null },
    crypto: { verifyEvent: (event) => Promise.resolve(verifyEvent(event)) },
    link: { isAvailable: () => true },
    services: deps.services,
    capabilities: { resolveEnvironment: deps.resolveEnvironment },
    onNappletRevoked: deps.onNappletRevoked,
    onNappletMessage: deps.onNappletMessage,
    ...(deps.onUnroutedMessage ? { onUnroutedMessage: deps.onUnroutedMessage } : {}),
  };
}
