# Architecture

kernl is three layers. kehto supplies the primitives, four kernl packages supply the opinions, and one app renders them. Nothing in a lower layer knows about a higher one.

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/web  (@kernlize/web)                        Astro 7 + Svelte 5    │
│  landing site at /         shell at /app/      docs at /docs/        │
├──────────────────────────────────────────────────────────────────────┤
│  @kernlize/core                                   composition root      │
│  createKernl · applesauce adapters · decodePointer → resolve →       │
│  plan → mount · guard pipeline · grants · describeChange · layouts   │
│       │                 │                   │                        │
│  @kernlize/guard      @kernlize/messaging     @kernlize/bridges               │
│  ingress, gate,    provider contract,   locators, Bridge contract,   │
│  focus firewall,   registry, composite  registry, HTTP bridge        │
│  CSP, profiles     dm adapter           with SSRF policy             │
├──────────────────────────────────────────────────────────────────────┤
│  kehto   @kehto/shell · runtime · acl · firewall · services · nip ·  │
│          wm                                                          │
│  applesauce   EventStore · RelayPool · AccountManager · signers ·    │
│               loaders                                                │
├──────────────────────────────────────────────────────────────────────┤
│  @napplet/core   NAP wire types, NapDomain, envelope dispatch        │
└──────────────────────────────────────────────────────────────────────┘
```

## The kehto layer

kehto is the runtime authority for how a NIP-5D shell composes. kernl uses these seams unchanged:

| kehto package | What kernl takes from it |
| --- | --- |
| `@kehto/shell` | `createShellBridge`, `buildShellCapabilities`, `resolveShellEnvironment`, `prepareNappletSrcdoc`, `denyNappletControllerAccess`, `renderNappletFramePolicyMeta`, `originRegistry`, the `ShellAdapter` hooks (including `filterNappletMessage`, `getFocusContext`, `onFirewallEvent`, `firewallPersistence` and `aclDefaultPolicy`), `ShellBridge.releaseDeferred` and the revocation model. |
| `@kehto/runtime` | The protocol engine behind the bridge: dispatch, the ACL gate (`bridge.runtime.aclState`), the runtime firewall (`bridge.runtime.firewallState`, with `setUnfocusedMultiplier` and `setBurstGuard`), the `ServiceRegistry` and `ConsentRequest`. |
| `@kehto/acl` | The grant store the runtime enforces, keyed by `dTag:hash`. kernl reaches it only through `bridge.runtime.aclState`. |
| `@kehto/firewall` | The pure `evaluate()` engine `@kernlize/guard` runs, and the `NappletRules` and `RateLimit` types `runtimeFirewallRules` translates into. |
| `@kehto/services` | `createRelayPoolService`, `createIdentityService`, `createThemeService`, `createNotifyService`, `createLinkService`, `createResourceService`, `createDmService`, `createOutboxService` and `createRelayPoolOutboxRouter`. |
| `@kehto/nip` | `resolveNapplet`, `openNappletArtifactCache` and `NAPPLET_KINDS` from `@kehto/nip/5d`. |
| `@kehto/wm` | `LayoutStrategy`, `WindowState`, `Rect` and `WindowPlacement`, which the layouts implement. |

kernl never re-implements a kehto primitive. When a seam is too narrow, kernl composes in front of it and takes the gap upstream. The four gaps found first, filed as kehto/web #397–#400, are released in `@kehto/shell` 0.32.0 and in use ([D-020](../decisions.md#d-020)); what is still open is in [Alpha status](../alpha-status.md#upstream-gaps).

## One event layer

Every relay connection, event store, signer, account and loader goes through applesauce v7 ([D-002](../decisions.md#d-002)). `createKernl` creates exactly one of each per shell, or uses the one the host passes in:

| Instance | Role | Adapted by |
| --- | --- | --- |
| `EventStore` | The in-memory, reactive store of every event the shell knows. Applets never receive a reference; `createIdentityProviders` (`applesauce/identity-providers.ts`) and `lookupReplaceable` read from it on their behalf. | kehto's identity service and the consent handler. |
| `RelayPool` | Every relay connection. | `createRelayPoolHooks` and `createRelayPoolLike` (`applesauce/relay-hooks.ts`) for `ShellAdapter.relayPool`; `createAppletRelayBackend`, `createDmRelayPool` and `createOutboxRelayPool` (`applesauce/relay-backend.ts`) for the relay, dm and outbox services. All of them route through `selectRelayTier`. |
| `AccountManager` | The signed-in accounts and their signers. | `createKernlAccounts` (`applesauce/accounts.ts`) refuses plaintext-key account types; `createAuthHooks` and `wrapAccountSigner` (`applesauce/auth-hooks.ts`) give kehto a signer that never reveals the account. |

`nostr-tools` is a peer dependency of `@kernlize/core`, because kehto and applesauce require it. kernl source never imports it, and `scripts/check-dependency-rules.mjs` fails the build if it does.

## The kernl packages

| Package | Depends on | Purpose |
| --- | --- | --- |
| [`@kernlize/guard`](../packages/guard.md) | `@kehto/firewall` | Flood control, visibility gate, focus-aware firewall, CSP profile, mitigation descriptions. Pure: no DOM, no timers, time is injected. |
| [`@kernlize/messaging`](../packages/messaging.md) | `@napplet/core` (types) | The provider contract and the composite backend. Structurally identical to kehto's `DmAdapter` so a composite can be handed to `createDmService` without translation, while the package stays free of a kehto dependency. |
| [`@kernlize/bridges`](../packages/bridges.md) | nothing | Locator parsing, the `Bridge` contract, the registry with its `authorize` hook, the HTTP bridge. |
| [`@kernlize/core`](../packages/core.md) | all of the above, kehto, applesauce | Composition: adapters, the applet lifecycle, the guard pipeline and runtime firewall rules, grants, consent summaries, layouts, the namespaced store. Browser-agnostic; the DOM is reached through `KernlHost` and `FrameLike`. |

The three leaf packages have zero framework dependencies and import nothing from each other. Only `core` composes them. The dependency rules are enforced by `pnpm check:deps`.

## Where each NAP domain is served from

An applet reaches the shell through the NAP domains in `window.napplet`. `createKernlServices` (`kernl-services.ts`) registers eight kehto services; `shell`, `inc`, `storage`, `keys` and `media` are routed by kehto's runtime itself. What one applet sees is `buildShellCapabilities(adapter).domains` narrowed by `createEnvironmentResolver(grants)`.

| NAP domain | Served by | kernl supplies | Guarded by |
| --- | --- | --- | --- |
| `shell`, `inc` | kehto runtime | the environment from `resolveShellEnvironment`, narrowed per identity | identity binding; baseline, no grant needed |
| `storage` | kehto runtime | the ACL state quota (`grants.setStateQuota`) | baseline; rate `storage:write` |
| `identity` | `createIdentityService` | the active signer through `createAuthHooks`; profile, follows, mutes and relays from `createIdentityProviders` | grant (`identity:read`), "your account" in the shell |
| `theme` | `createThemeService` | `KernlOptions.theme` when `isTheme` accepts it | baseline |
| `relay` | `createRelayPoolService` | `createAppletRelayBackend` over the one pool, routed by `selectRelayTier` | grant; rates `relay:subscribe`, `relay:publish`; subscribe envelope cap |
| `outbox` | `createOutboxService` | `createRelayPoolOutboxRouter` over `createOutboxRelayPool`, relay lists from `createIdentityProviders`, signing through the active signer (`denied:read-only` without one) | grant; rates `outbox:subscribe`, `outbox:publish`; consent for destructive kinds |
| `resource` | `createResourceService` | `createBridgeResourceResolver(bridges)` with the requesting applet named through `resourceInitFor` | grant; rate `resource:bytes`, resource envelope cap, hidden resource allowance, SSRF policy |
| `dm` | `createDmService` | `messaging.composite()` | grant; rate `dm:send`; provider availability |
| `notify` | `createNotifyService` | `host.notify` with tone `info` | grant |
| `link` | `createLinkService` | `host.openLink` after `LINK_PROTOCOLS` (`https:`, `mailto:`) allowed it | grant |
| `keys`, `media` | kehto runtime | nothing: hotkeys are not forwarded and no media hook is wired | grant |

So the shell offers thirteen domains: the baseline `shell`, `inc`, `theme` and `storage`, and `identity`, `relay`, `outbox`, `resource`, `dm`, `notify`, `link`, `keys` and `media` behind a grant. Domains kernl does not serve (`config`, `cvm`, `upload`, `intent`, `fs`, `llm`, `cache`) have a row in `DOMAIN_CAPABILITIES` so a grant can be expressed, but the shell does not offer them and `grants.allowDomain` refuses them with `invalid:domain`. [Identity and grants](./identity-and-grants.md) explains how the set is narrowed.

## The mount path

`createAppletLifecycle` (`kernl-lifecycle.ts`) turns an address into a running window in four steps, and the order is load-bearing:

1. **`decodePointer(input)`** (`applets/pointer.ts`) turns the address into `{ kind: 'address' | 'event', … }` and nothing more. Trust comes from verifying the event, never from the pointer.
2. **`resolve(pointer)`** fetches the manifest from the pointer's relay hints plus the `apps` tier (`fetchManifestEvent`), then verifies the signature and the artifact bytes by hash through `resolveApplet` over kehto's `resolveNapplet` (`applets/resolve.ts`). Cached bytes are re-hashed on every read. Gateways and caches are accelerators, never identity.
3. **`plan(summary)`** calls `grants.ensure(identity)`, then `planMount` (`applets/plan.ts`): it refuses markup that declares a frame (`denied:nested-frame`), then builds the environment from `resolveShellEnvironment`, the guard's CSP and the namespace prelude inserted by `prepareNappletSrcdoc`, the Trusted Types directives and frame lock spliced in after them ([D-014](../decisions.md#d-014)), `sandbox: 'allow-scripts'`, and `missingRequired`.
4. **`mount(plan, frame)`** installs the profile's rates in kehto's runtime firewall with `applyRuntimeFirewallRules`, then `mountApplet` (`applets/mount.ts`) hardens the frame, registers the window in `originRegistry`, sets the environment, calls `bridge.observeFrame`, and only then assigns `srcdoc`. The frame has `sandbox="allow-scripts"` and `denyNappletControllerAccess` applied; it never has `src` and never `allow-same-origin`.

Every revocation reason (`window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed`, `host`) and a guard quarantine removes the iframe and drops the guard's state for that window. [Security posture](../policies/security-posture.md) lists the rules this path must keep.

## The app

`apps/web` is Astro 7 with Svelte 5 islands. It owns the landing site at `/`, the shell at `/app/`, and the `KernlHost` that gives `@kernlize/core` a page: `localStorage`, the consent dialog, notices, link confirmation and window visibility. It creates the iframes, wires `window.addEventListener('message', kernl.handleWindowMessage)` once, and renders the launcher, the grants panel per window, the guard panel and the provider picker. Where windows go, which is focused and what the guard is told about each belong to a `WindowManager` the app makes in one file, `windows.ts`, so that they can be changed or replaced there ([Layouts](./layouts.md), [D-022](../decisions.md#d-022)). The published packages contain none of this; the app is the only framework-dependent workspace ([D-004](../decisions.md#d-004)). `?preview=1` swaps in `preview-kernl.ts`, which implements the same `Kernl` contract without a network ([D-011](../decisions.md#d-011)).
