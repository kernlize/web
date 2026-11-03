# @kernl/core

Opinionated shell composition over kehto and applesauce. Browser-agnostic: the DOM is reached only through injected hooks, so the whole composition runs in vitest.

| Field | Value |
| --- | --- |
| Package | `@kernl/core` |
| Version | `0.1.0` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts` |
| Dependencies | `@kernl/guard`, `@kernl/messaging`, `@kernl/bridges` (`workspace:^`); `@kehto/acl ^0.20.2`, `@kehto/firewall ^0.6.3`, `@kehto/runtime ^0.27.2`, `@kehto/shell ^0.29.0`, `@kehto/services ^0.29.0`, `@kehto/nip ^0.8.0`, `@kehto/wm ^0.0.2`; `applesauce-core ^7.0.3`, `applesauce-relay ^7.0.0`, `applesauce-signers ^7.0.1`, `applesauce-accounts ^7.0.2`, `applesauce-loaders ^7.0.2`; `rxjs ^7.8.2` |
| Peer dependencies | `@napplet/core >=0.37.0 <0.38.0`, `@napplet/nap >=0.36.0 <0.37.0`, `@napplet/shim >=0.30.0`, `nostr-tools >=2.23.3 <=2.x` (required by kehto and applesauce; never imported here) |
| Side effects | none |

## Install

```bash
pnpm add @kernl/core
```

## Purpose

This is where the five opinions in `SOUL.md` become code. `createKernl` builds one `EventStore`, one `RelayPool` and one `AccountManager`, adapts them to kehto's relay and dm contracts, registers the kehto services, wires the guard in front of `createShellBridge`, and exposes the applet lifecycle (`resolveApplet` → `planMount` → `mountApplet`), the grants surface, consent summaries and layouts to the shell app. The layering is in [Architecture](../concepts/architecture.md).

## Main exports

| Export | Kind | Role |
| --- | --- | --- |
| `createKernl(options)`, `Kernl`, `KernlOptions` | factory, type | The composition root: store, pool, accounts, bridge, registries, grants, guard per window |
| `createRelayPoolAdapter(pool, store)` | function | Satisfies kehto's `RelayPoolLike` and `RelayPoolServiceOptions` over the shared applesauce `RelayPool` |
| `createDmRelayPool(pool)` | function | Satisfies kehto's `DmRelayPool` over the same pool |
| `createAccountSigner(accounts)` | function | kehto `AuthHooks` over applesauce `AccountManager`; keys never leave the signer |
| `resolveApplet(address, deps)`, `ResolvedApplet` | function, type | Address to verified manifest and artifact bytes through `@kehto/nip/5d` `resolveNapplet`, with re-verified cache |
| `planMount(resolved, deps)`, `MountPlan` | function, type | Identity, narrowed environment, guard profile, prepared `srcdoc` with the CSP injected |
| `mountApplet(plan, frame, deps)`, `MountedApplet` | function, type | register → set environment → observe frame → assign `srcdoc`; `setProfile`, `revoke`, `close` |
| `describeChange(current, proposed)`, `ChangeDescription` | function, type | Semantic diffs for kinds 0, 3, 5 and 10002 |
| `createGrants(deps)`, `Grants`, `Grant` | factory, type | `list`, `grant`, `revoke`, `revokeAll`, `block`, `unblock` over `@kehto/acl` plus environment re-resolution |
| `layouts`, `Layout` | const, type | Window layouts implementing `@kehto/wm` contracts: `stack`, `tile`, `focus` |
| `createPersistence(storage)`, `Persistence` | factory, type | Grants, profile overrides, messaging preferences and relay configuration, namespaced per account |

## Scope

- Composes; does not re-implement a kehto primitive. Local layers exist only where `ShellAdapter` or `createRuntime` has no hook, and each is named in [Alpha status](../alpha-status.md#upstream-gaps).
- Imports events, relays, signing and accounts from applesauce only. `nostr-tools` is a transitive peer and `pnpm check:deps` fails if it is imported.
- Holds no UI. `apps/web` supplies the iframe, the focus events and the prompts through `KernlOptions` hooks.
- Serialises no private key. `PasswordAccount` is the only persisted form of an account and it is applesauce's.

## API reference

Generated module: [`_kernl_core`](/api/modules/_kernl_core.html){target="_self"}
