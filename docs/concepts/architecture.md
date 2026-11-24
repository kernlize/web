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
│  rate limiter,     registry, composite  registry, HTTP bridge        │
│  CSP, profiles     dm adapter           with SSRF policy             │
├──────────────────────────────────────────────────────────────────────┤
│  kehto   @kehto/shell · runtime · acl · firewall · services · nip ·  │
│          rate-limit · wm                                             │
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
| `@kehto/shell` | `createShellBridge`, `buildShellCapabilities`, `resolveShellEnvironment`, `prepareNappletSrcdoc`, `denyNappletControllerAccess`, `renderNappletFramePolicyMeta`, `originRegistry`, the `ShellAdapter` hooks (including `filterNappletMessage`, `getFocusContext`, `permissions` and `aclDefaultPolicy`), `ShellBridge.releaseDeferred` and the revocation model. |
| `@kehto/runtime` | The protocol engine behind the bridge: dispatch, the ACL gate (`bridge.runtime.aclState`), the approval coordinator and grant store behind `permissions` (`bridge.runtime.permissions`), the `ServiceRegistry` and `ConsentRequest`. |
| `@kehto/acl` | The grant store the runtime enforces, keyed by `dTag:hash`. kernl reaches it only through `bridge.runtime.aclState`. |
| `@kehto/firewall` | The approval authority: scoped grants, and the `allow`, `ask` and `deny` rules (`createPermissionRules`, `setPermissionRule`, `resolvePermissionRule`) kernl keeps for the user and hands the runtime as `permissions.defaultDecision` ([D-056](../decisions.md#d-056)). |
| `@kehto/rate-limit` | The pure `evaluateRateLimit` that `@kernlize/guard`'s rate limiter and `createRuntimeRateLimiter` both run, and `createRateLimiter` with `defaultPromptRateLimitConfig` for the budget on firewall questions. |
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
| [`@kernlize/guard`](../packages/guard.md) | `@kehto/rate-limit` | Flood control, visibility gate, focus-aware rate limiter, CSP profile, mitigation descriptions. Pure: no DOM, no timers, time is injected. |
| [`@kernlize/messaging`](../packages/messaging.md) | `@napplet/core` (types) | The provider contract and the composite backend. Structurally identical to kehto's `DmAdapter` so a composite can be handed to `createDmService` without translation, while the package stays free of a kehto dependency. |
| [`@kernlize/bridges`](../packages/bridges.md) | nothing | Locator parsing, the `Bridge` contract, the registry with its `authorize` hook, the HTTP bridge. |
| [`@kernlize/core`](../packages/core.md) | all of the above, kehto, applesauce | Composition: adapters, the applet lifecycle, the guard pipeline and the runtime's rate limiter, the firewall's rules and questions, grants, consent summaries, layouts, the namespaced store. Browser-agnostic; the DOM is reached through `KernlHost` and `FrameLike`. |

The three leaf packages have zero framework dependencies and import nothing from each other. Only `core` composes them. The dependency rules are enforced by `pnpm check:deps`.

## Where each NAP domain is served from

An applet reaches the shell through the NAP domains in `window.napplet`. `createKernlServices` (`kernl-services.ts`) registers kehto's services the kernel answers and kernl's `media` ([Media](./media.md)); modules add the rest, such as `dm` from the messaging module and `common`, `upload` and `config` from the social, files and settings modules; `shell`, `inc`, `storage` and `keys` are routed by kehto's runtime itself. What one applet sees is `buildShellCapabilities(adapter).domains` narrowed by `createEnvironmentResolver(grants)`.

| NAP domain | Served by | kernl supplies | Guarded by |
| --- | --- | --- | --- |
| `shell`, `inc` | kehto runtime | the environment from `resolveShellEnvironment`, narrowed per identity | identity binding; baseline, no grant needed |
| `storage` | kehto runtime | the ACL state quota (`grants.setStateQuota`) | baseline; rate `storage:write` |
| `identity` | `createIdentityService` | the active signer through `createAuthHooks`; profile, follows, mutes and relays from `createIdentityProviders` | grant (`identity:read`), "your account" in the shell |
| `theme` | `createThemeService`, through `themeModule` | `KernlOptions.theme` when `isTheme` accepts it; without the module the domain is withheld ([D-062](../decisions.md#d-062)). `kernl.theme.publish` tells the applets that are open when the colours change ([D-064](../decisions.md#d-064)) | baseline |
| `relay` | `createRelayPoolService`, wrapped by `createAppletRelayService` | `createAppletRelayBackend` over the one pool; publishes planned by kind with `selectRelayTier` and sent only to the plan | grant; rates `relay:subscribe`, `relay:publish`; subscribe envelope cap |
| `outbox` | `createOutboxService` | `createRelayPoolOutboxRouter` over `createOutboxRelayPool`, relay lists from `createIdentityProviders`, signing through the active signer (`denied:read-only` without one) | grant; rates `outbox:subscribe`, `outbox:publish`; consent for destructive kinds |
| `resource` | `createResourceService` | `createBridgeResourceResolver(bridges)` with the requesting applet named through `resourceInitFor` | grant; rate `resource:bytes`, resource envelope cap, hidden resource allowance, SSRF policy |
| `dm` | `createDmService`, from the messaging module | `messaging.composite()` over the listed providers | grant; rate `dm:send`; provider availability |
| `notify` | `createNotifyService` | `host.notify` with tone `info` | grant |
| `link` | `createLinkService` | `host.openLink` after `LINK_PROTOCOLS` (`https:`, `mailto:`) allowed it | grant |
| `intent` | `createIntentService` with kernl's router (`createKernlIntents`), through `intentsModule` | the installed set, the user's defaults and published preferences, `host.chooseHandler`, `host.openApplet`; delivery over the target's bound port | grant (`intent:read`, `intent:write`); rate `intent:invoke`; see [The store and intents](./store-and-intents.md) |
| `cvm` | `createRemoteToolsService`: one kehto tool service and transport per window | the window's own key from `createWindowIdentities`; relays the applet names, else `remoteTools.relays`, else the `super` tier ([D-041](../decisions.md#d-041)) | grant (`cvm:call`), "remote tools" in the shell |
| `webrtc` | `createDirectConnectionsService`: one kehto WebRTC service per window over `createDirectSignaling` | `soy-rtc/1` signaling under the window's own key over the one pool; relays from `directConnections.relays`, else the `super` tier; offered only where the page has `RTCPeerConnection` ([D-042](../decisions.md#d-042)) | grant, checked by kernl's approval step since kehto's ACL has no capability for it; the person is asked about every session |
| `config` | `createConfigService` | `createAppletConfig` over `host.presentSettings`; offered only when the host has it ([D-036](../decisions.md#d-036)) | grant (`config:read`) |
| `common` | `createCommonService`, through `socialModule` | `createCommonActions` over the kernel's consented signing: profiles, follows, reactions and reports ([D-035](../decisions.md#d-035)) | grant |
| `upload` | `createUploadService`, through `filesModule` | `createBlossomUploader` over the account's file servers, asking once per file ([D-033](../decisions.md#d-033)) | grant (`upload:write`); consent per file |
| `keys` | `createShortcutsService` over kehto's `createKeysService`, through `keysModule` | a key listener on the page's `document` that passes on only the presses the shell did not use; `keys.action` only to the focused window; the host's reserved chords are never bound; `keys.forward` goes to `host.onShortcut` ([D-054](../decisions.md#d-054)) | baseline (`keys:bind`, `keys:forward`); `GuardPipeline.observe` drops a held key's repeats and an unfocused window's forwards, and holds registrations through a window's first second |
| `media` | kehto runtime | nothing: no media hook is wired | grant |

So the shell offers the baseline `shell`, `inc`, `theme`, `storage` and `keys`, and `identity`, `relay`, `outbox`, `resource`, `cvm`, `upload`, `common`, `dm`, `notify`, `link`, `intent` and `media` behind a grant, with `config` too when the host draws settings forms and `webrtc` where the page can make peer connections. Domains kernl does not serve (`fs`, `llm`, `cache`) have a row in `DOMAIN_CAPABILITIES` so a grant can be expressed, but the shell does not offer them and `grants.allowDomain` refuses them with `invalid:domain`. [Identity and grants](./identity-and-grants.md) explains how the set is narrowed.

## The mount path

`createAppletLifecycle` (`kernl-lifecycle.ts`) turns an address into a running window in four steps, and the order is load-bearing:

1. **`decodePointer(input)`** (`applets/pointer.ts`) turns the address into `{ kind: 'address' | 'event', … }` and nothing more. Trust comes from verifying the event, never from the pointer.
2. **`resolve(pointer)`** fetches the manifest from the pointer's relay hints plus the `apps` tier (`fetchManifestEvent`), then verifies the signature and the artifact bytes by hash through `resolveApplet` over kehto's `resolveNapplet` (`applets/resolve.ts`). Cached bytes are re-hashed on every read. Gateways and caches are accelerators, never identity.
3. **`plan(summary)`** calls `grants.ensure(identity)` and installs the applet ([The store and intents](./store-and-intents.md#installing)), has the start admitted by the firewall for the domains the grants leave (`denied:firewall` when a required one is refused, [Guard](./guard.md#the-firewall)), then `planMount` (`applets/plan.ts`): it refuses markup that declares a frame (`denied:nested-frame`), then builds the environment from `resolveShellEnvironment`, narrowed to the domains the firewall admitted, the guard's CSP and the namespace prelude inserted by `prepareNappletSrcdoc`, the Trusted Types directives and frame lock spliced in after them ([D-014](../decisions.md#d-014)), `sandbox: 'allow-scripts'`, and `missingRequired`.
4. **`mount(plan, frame)`** checks that the firewall's admission still stands (`denied:admission-expired` otherwise), then `mountApplet` (`applets/mount.ts`) hardens the frame, registers the window in `originRegistry` with the principal the firewall knows it by, sets the environment, calls `bridge.observeFrame`, and only then assigns `srcdoc`. The frame has `sandbox="allow-scripts"` and `denyNappletControllerAccess` applied; it never has `src` and never `allow-same-origin`.

Every revocation reason (`window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed`, `host`), a guard quarantine and a firewall answer taken back removes the iframe and drops the guard's state for that window. [Security posture](../policies/security-posture.md) lists the rules this path must keep.

## The app

`apps/web` is Astro 7 with Svelte 5 islands. It owns the landing at `/`, the long-form pages under `/about/`, the shell at `/app/`, and the `KernlHost` that gives `@kernlize/core` a page: `localStorage`, the consent dialog, the handler chooser, notices, link confirmation, opening and focusing windows, and window visibility. It creates the iframes, wires `window.addEventListener('message', kernl.handleWindowMessage)` once, and renders the store, the grants panel per window, the guard panel and the provider picker. Where windows go, which is focused and what the guard is told about each belong to a `WindowManager` the app makes in one file, `windows.ts`, so that they can be changed or replaced there ([Layouts](./layouts.md), [D-022](../decisions.md#d-022)). The published packages contain none of this; the app is the only framework-dependent workspace ([D-004](../decisions.md#d-004)). `?preview=1` swaps in `preview-kernl.ts`, which implements the same `Kernl` contract without a network ([D-011](../decisions.md#d-011)). The site's pages cross into one another without reloading, behind a WebGL curtain; `/app/` takes no part in that and is always a fresh page load, so its frame policy is in the HTML the server sent ([D-023](../decisions.md#d-023)).
