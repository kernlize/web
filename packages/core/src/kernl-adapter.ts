import type { AccountManager } from 'applesauce-accounts';
import { verifyEvent } from 'applesauce-core/helpers';
import type { CapabilityHooks, NappletRevocation, ShellAdapter, UnroutedMessageInfo } from '@kehto/shell';
import type { ServiceRegistry } from '@kehto/runtime';
import type { RelayTier, RelayTiers } from './types.js';
import { createAuthHooks } from './applesauce/auth-hooks.js';
import type { SigningConsent } from './consent/handler.js';
import { createRelayPoolHooks, type ApplesaucePool } from './applesauce/relay-hooks.js';
import type { RuntimeFirewallHooks } from './guard/runtime-rules.js';

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
  /** Decides every port envelope before kehto's runtime sees it; see `GuardPipeline.observe`. */
  readonly filterNappletMessage: NonNullable<ShellAdapter['filterNappletMessage']>;
  /** Whether a window has focus, as the shell's window manager reports it. */
  readonly getFocusContext: (windowId: string) => { focused: boolean };
  /** The runtime firewall's persistence and event sink; see `createRuntimeFirewallHooks`. */
  readonly runtimeFirewall: RuntimeFirewallHooks;
  readonly onUnroutedMessage?: (info: UnroutedMessageInfo) => void;
}

const UPLOAD_BACKEND = Object.freeze({ rails: Object.freeze(['blossom']) });

function isTier(tier: string): tier is RelayTier {
  return TIERS.includes(tier);
}

/**
 * Build kehto's `ShellAdapter` from kernl's parts.
 *
 * Choices kehto left open, decided here: windows are created by the host,
 * which opens an intent's target for it, not by applets (`createWindow`
 * returns null); the `intent` domain is offered, served by kernl's router; hotkeys are
 * not forwarded; there is no worker relay, the applesauce pool is the only
 * event source; every signature made for an applet window passes the consent
 * gate; update behaviour is `banner`; event signatures are verified by
 * applesauce; every applet's environment is narrowed by the grants layer; the
 * ACL is restrictive, so an applet holds only what the grants layer wrote; and
 * every port envelope passes kernl's guard before the runtime sees it.
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
    // kehto offers the upload domain only when both the service and this backend are present; kernl's uploads are Blossom (D-033).
    upload: { getUploader: () => (deps.services.upload ? UPLOAD_BACKEND : null) },
    common: { isAvailable: () => deps.services.common !== undefined },
    crypto: { verifyEvent: (event) => Promise.resolve(verifyEvent(event)) },
    link: { isAvailable: () => true },
    intent: { isAvailable: () => true },
    services: deps.services,
    capabilities: { resolveEnvironment: deps.resolveEnvironment },
    onNappletRevoked: deps.onNappletRevoked,
    filterNappletMessage: deps.filterNappletMessage,
    getFocusContext: deps.getFocusContext,
    ...deps.runtimeFirewall,
    aclDefaultPolicy: 'restrictive',
    ...(deps.onUnroutedMessage ? { onUnroutedMessage: deps.onUnroutedMessage } : {}),
  };
}
