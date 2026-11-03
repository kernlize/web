# Architecture

kernl is three layers. kehto supplies the primitives, four kernl packages supply the opinions, and one app renders them. Nothing in a lower layer knows about a higher one.

```
┌──────────────────────────────────────────────────────────────────────┐
│  apps/web  (@kernl/web)                        Astro 7 + Svelte 5    │
│  landing site at /         shell at /app/      docs at /docs/        │
├──────────────────────────────────────────────────────────────────────┤
│  @kernl/core                                   composition root      │
│  createKernl · applesauce adapters · resolveApplet → planMount →     │
│  mountApplet · describeChange · layouts · persistence                │
│       │                 │                   │                        │
│  @kernl/guard      @kernl/messaging     @kernl/bridges               │
│  ingress, gate,    provider contract,   locators, Bridge contract,   │
│  focus firewall,   registry, composite  registry, HTTP bridge        │
│  CSP, profiles     dm adapter           with SSRF policy             │
├──────────────────────────────────────────────────────────────────────┤
│  kehto   @kehto/shell · runtime · acl · firewall · services · nip · wm │
│  applesauce   EventStore · RelayPool · AccountManager · signers ·     │
│               loaders · factory                                       │
├──────────────────────────────────────────────────────────────────────┤
│  @napplet/core   NAP wire types, NapDomain, envelope dispatch         │
└──────────────────────────────────────────────────────────────────────┘
```

## The kehto layer

kehto is the runtime authority for how a NIP-5D shell composes. kernl uses these seams unchanged:

| kehto package | What kernl takes from it |
| --- | --- |
| `@kehto/shell` | `createShellBridge`, `originRegistry`, `prepareNappletSrcdoc`, `buildNappletCsp`, `denyNappletControllerAccess`, `resolveShellEnvironment`, the `ShellAdapter` hooks and the revocation model. |
| `@kehto/runtime` | The protocol engine behind the bridge: dispatch, ACL gates, service registry, `firewallState`. |
| `@kehto/acl` | Grant state keyed by `dTag:hash`, `grant`, `revoke`, `block`, serialisation. |
| `@kehto/firewall` | The pure `evaluate(config, state, observation)` engine, config mutations, `serialize`/`deserialize`. |
| `@kehto/services` | Reference service handlers for identity, relay, outbox, storage, resource, theme, config, lists, notify, media and dm. |
| `@kehto/nip` | `resolveNapplet` from `@kehto/nip/5d` for artifact verification and caching; NIP-51, NIP-65 and NIP-66 helpers. |
| `@kehto/wm` | Window-management contracts the layouts implement. |

kernl never re-implements a kehto primitive. When a seam is too narrow, kernl composes in front of it and files the gap; the two current gaps are in [Alpha status](../alpha-status.md#upstream-gaps).

## One event layer

Every relay connection, event store, signer, account, loader and event factory goes through applesauce v7 (D-002). `@kernl/core` creates exactly one of each per shell:

| Instance | Role | Who sees it |
| --- | --- | --- |
| `EventStore` | The in-memory, reactive store of every event the shell knows. | Services read from it on an applet's behalf. Applets never receive a reference. |
| `RelayPool` | Every relay connection. | kehto's `RelayPoolLike`, `RelayPoolServiceOptions` and `DmRelayPool` contracts are satisfied by thin adapters over this one pool. |
| `AccountManager` | The signed-in accounts and their signers. | Signers are applesauce signers. Keys never leave a signer instance; the only serialised form is `PasswordAccount`. |

`nostr-tools` remains a transitive peer of kehto and applesauce. kernl source never imports it, and `scripts/check-dependency-rules.mjs` fails the build if it does.

## The kernl packages

| Package | Depends on | Purpose |
| --- | --- | --- |
| [`@kernl/guard`](../packages/guard.md) | `@kehto/firewall` | Flood control, visibility gate, focus-aware firewall, CSP profile, mitigation descriptions. Pure: no DOM, no timers, time is injected. |
| [`@kernl/messaging`](../packages/messaging.md) | `@napplet/core` (types) | The provider contract and the composite backend. Structurally identical to kehto's `DmAdapter` so a composite can be handed to `createDmService` without translation, while the package stays free of a kehto dependency. |
| [`@kernl/bridges`](../packages/bridges.md) | nothing | Locator parsing, the `Bridge` contract, the registry with its consent hook, the HTTP bridge. |
| [`@kernl/core`](../packages/core.md) | all of the above, kehto, applesauce | Composition: adapters, applet resolution, mount plan, consent summaries, layouts, persistence. Browser-agnostic; the DOM is reached through injected hooks. |

The three leaf packages have zero framework dependencies and import nothing from each other. Only `core` composes them. The dependency rules are enforced by `pnpm check:deps`.

## Where each NAP domain is served from

An applet reaches the shell through the NAP domains in `window.napplet`. Each domain is served by one kehto service, fed by one kernl adapter or registry:

| NAP domain | kehto service | kernl supplies | Guarded by |
| --- | --- | --- | --- |
| `shell` | runtime | capability advertisement narrowed by `resolveEnvironment` | identity binding |
| `identity` | `createIdentityService` | `AccountManager` active account | grant |
| `relay` | relay service over `RelayPoolLike` | adapter over the shared `RelayPool`, reads from `EventStore` | ingress guard, rate limits, subscribe envelope cap |
| `outbox` | outbox service | NIP-65 relay plan from `@kehto/nip`, publish through the pool | rate limits, consent for destructive kinds |
| `keys` | keys proxy | applesauce signer behind consent | consent, grant |
| `storage` | storage service | shell persistence namespaced per applet identity | rate limit `storage:write` |
| `resource` | resource service | `BridgeRegistry.resolve` (HTTP bridge and others) | hidden resource allowance, resource envelope cap, SSRF policy |
| `dm` | `createDmService` | `MessagingRegistry.composite()` | rate limit `dm:send`, provider availability |
| `theme`, `config`, `lists`, `notify`, `media` | kehto reference services | shell state | grant where the domain writes |
| `intent` | intent hooks | shell intent router | rate limit `intent:invoke` |

The exact set an applet sees is whatever `shell.ready` delivers for its identity. [Identity and grants](./identity-and-grants.md) explains how that set is narrowed.

## The mount path

`@kernl/core` turns an address into a running window in three steps, and the order is load-bearing:

1. **`resolveApplet(address)`** fetches the manifest event, verifies the signature, fetches the artifact bytes by hash through `@kehto/nip/5d` `resolveNapplet`, and re-verifies cached bytes on every read. Gateways and caches are accelerators, never identity.
2. **`planMount(resolved)`** computes the identity `(dTag, artifactHash)`, the narrowed environment, the guard profile for this applet, and the prepared `srcdoc` with the CSP injected outside the signed bytes.
3. **`mountApplet(plan, frame)`** registers the iframe window in `originRegistry`, sets the environment, calls `bridge.observeFrame`, and only then assigns `srcdoc`. The frame has `sandbox="allow-scripts"` and `denyNappletControllerAccess` applied; it never has `src` and never `allow-same-origin`.

Every revocation reason (`window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed`, `host`) removes the iframe and drops the guard's state for that window. [Security posture](../policies/security-posture.md) lists the rules this path must keep.

## The app

`apps/web` is Astro 7 with Svelte 5 islands. It owns the landing site at `/`, the shell at `/app/`, and the glue that gives `@kernl/core` a DOM: iframe creation, the window manager's focus events (which feed the guard's visibility), the grants panel, the provider picker and the bridge consent prompts. The published packages contain none of this; the app is the only framework-dependent workspace (D-004).
