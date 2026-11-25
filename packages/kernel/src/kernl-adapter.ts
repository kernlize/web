import type { AccountManager } from 'applesauce-accounts';
import { verifyEvent } from 'applesauce-core/helpers';
import type { CapabilityHooks, NappletRevocation, ShellAdapter, UnroutedMessageInfo } from '@kehto/shell';
import type { PermissionAdapter, ServiceRegistry } from '@kehto/runtime';
import type { RelayTier, RelayTiers, ShortcutKey } from './types.js';
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
  /** Domains kehto offers natively that no loaded module answers, withheld from every applet (D-061). */
  readonly disabledDomains?: readonly string[];
  readonly onNappletRevoked: (revocation: NappletRevocation) => void;
  /** Decides every port envelope before kehto's runtime sees it; see `GuardPipeline.observe`. */
  readonly filterNappletMessage: NonNullable<ShellAdapter['filterNappletMessage']>;
  /** Whether a window has focus, as the shell's window manager reports it. */
  readonly getFocusContext: (windowId: string) => { focused: boolean };
  /** The firewall's host side: rules, questions, stored answers and the runtime's rate limiter; see `createFirewallPermissions`. */
  readonly permissions: PermissionAdapter;
  readonly onUnroutedMessage?: (info: UnroutedMessageInfo) => void;
  /** Hears every envelope on a bound port before the guard decides it; observe-only. */
  readonly onNappletMessage?: NonNullable<ShellAdapter['onNappletMessage']>;
  /** Takes a key an applet had no shortcut for, so the shell's own shortcuts work while an applet has focus (D-054). */
  readonly onShortcut?: (key: ShortcutKey) => void;
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
 * returns null); the `intent` domain is offered, served by kernl's router; a key an
 * applet had no shortcut for goes to the host's `onShortcut`; there is no worker relay, the applesauce pool is the only
 * event source; every signature made for an applet window passes the consent
 * gate; update behaviour is `banner`; event signatures are verified by
 * applesauce; every applet's environment is narrowed by the grants layer; the
 * ACL is restrictive, so an applet holds only what the grants layer wrote, and
 * under `permissions` that is a ceiling no firewall answer can exceed; every
 * request is decided by the firewall; and every port envelope passes kernl's
 * guard before the runtime sees it.
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
    hotkeys: { executeHotkeyFromForward: (key) => deps.onShortcut?.(key) },
    workerRelay: { getWorkerRelay: () => null },
    // kehto offers the upload domain only when both the service and this backend are present; kernl's uploads are Blossom (D-033).
    upload: { getUploader: () => (deps.services.upload ? UPLOAD_BACKEND : null) },
    common: { isAvailable: () => deps.services.common !== undefined },
    // kehto offers direct connections only when this says so; kernl registers the service only where the page can make peer connections (D-042).
    webrtc: { isAvailable: () => deps.services.webrtc !== undefined },
    crypto: { verifyEvent: (event) => Promise.resolve(verifyEvent(event)) },
    link: { isAvailable: () => true },
    intent: { isAvailable: () => true },
    services: deps.services,
    capabilities: { resolveEnvironment: deps.resolveEnvironment, ...(deps.disabledDomains?.length ? { disabledDomains: deps.disabledDomains } : {}) },
    onNappletRevoked: deps.onNappletRevoked,
    filterNappletMessage: deps.filterNappletMessage,
    getFocusContext: deps.getFocusContext,
    permissions: deps.permissions,
    aclDefaultPolicy: 'restrictive',
    ...(deps.onUnroutedMessage ? { onUnroutedMessage: deps.onUnroutedMessage } : {}),
    ...(deps.onNappletMessage ? { onNappletMessage: deps.onNappletMessage } : {}),
  };
}
