# kernl

kernl is an opinionated shell for sandboxed web applets. It is built on [kehto](https://github.com/kehto/web), the unopinionated NIP-5D toolkit, and it treats the person at the keyboard as the only principal who matters.

A shell has two jobs. It gives the user a place where their identity, relays, contacts, media and messages are theirs and portable. And it gives an untrusted program a place to run where the worst it can do is bounded. kernl does both, and when kehto offers a way to bound an applet further, kernl turns it on by default.

::: warning Alpha
kernl is a first draft. The four packages build, the contracts are stable enough to document, and the shell runs. Several backends are contracts without implementations, and downloads, sharing and mail work by handing off to apps on the device. Read [Alpha status](./alpha-status.md) before depending on anything here.
:::

## What kernl decides that kehto leaves open

kehto ships `@kehto/{acl,firewall,runtime,shell,services,nip,wm}` and deliberately does not pick a relay library, a signer, a consent model, a layout engine or a deployment story. kernl picks all of them:

| Opinion | kernl's choice |
| --- | --- |
| Event layer | [applesauce](https://applesauce.build) v7 only. One `EventStore`, one `RelayPool`, one `AccountManager` per shell. `nostr-tools` is never imported by kernl source. |
| Containment | Opaque-origin `srcdoc` iframe, `sandbox="allow-scripts"`, zero-network CSP, every network path through a shell service the user can see, rate-limit and revoke. |
| Mitigations | Every kehto mitigation ships on, in the `strict` [guard](./concepts/guard.md) profile. kehto's runtime firewall refuses requests over the profile's rates and a startup burst, and refuses the oversized downloads and queries kernl measures; kernl's own layers observe every port message just before dispatch, report what they see and quarantine floods, which stops the message that crossed the limit. kehto's not-yet-released nested-frame lock is applied through a port in `@kernl/guard` ([D-014](./decisions.md#d-014)). The hosted shell boots `strict`, and only the user loosens it there: shell-wide in this draft, reset to `strict` on every boot, per applet later. An embedding host may choose the starting profile (`KernlOptions.guard.profile`), which changes limits only; the sandbox, the CSP, the frame lock and consent are fixed. |
| Protocols | One identity layer, many [bridges](./concepts/bridges.md) named by what they do for the user, never by the wire format. Web fetch runs in the shell behind an SSRF policy. Downloads, sharing and mail hand the address to an app on the user's device after the user confirms leaving kernl: kernl connects to nothing for them, and the device app's own network behaviour is outside kernl. |
| Messaging | Any reasonable private-messaging protocol, exposed through one contract. [Providers](./concepts/messaging.md) describe their security properties truthfully and the shell does not rank them. `private` and `legacy` work in the live shell when the signed-in account's signer can encrypt; `ratchet` needs a runtime and is unavailable; the preview runs all three over the in-memory backend. |

kernl does not fork kehto ([D-001](./decisions.md#d-001)). When kehto lacks a hook kernl needs, kernl composes around it and takes the gap upstream. The four gaps found so far, filed upstream as kehto/web #397–#400, are listed in [Alpha status](./alpha-status.md#upstream-gaps).

## Three doors

**Use the shell.** Try the hosted preview at [kernlize.github.io/app/?preview=1](https://kernlize.github.io/app/?preview=1), which needs no install and no account, or open the live shell, sign in with a browser extension or a remote signer, and open an applet by its address. Start with [Run the shell](./tutorials/run-the-shell.md), then read [Grant and revoke](./how-tos/grant-and-revoke.md) to understand what the shell asks you and why.

**Build an applet for it.** Applets are ordinary NIP-5D napplets; kernl adds nothing to the wire format. What kernl changes is the posture: fewer domains advertised until granted, including the user's account, rate limits, no frames of the applet's own, closer watch while hidden or unfocused, and quarantine for floods. [Write an applet](./tutorials/write-an-applet.md) builds, tests, publishes and opens one; [Applets under kernl](./concepts/applets-under-kernl.md) tells you what to expect and how to test against it.

**Extend the shell.** [Embed kernl core](./how-tos/embed-kernl-core.md) in your own page, add a [messaging provider](./how-tos/add-a-messaging-provider.md) or a [bridge backend](./how-tos/add-a-bridge-backend.md), or change how the guard is composed. Start with [Architecture](./concepts/architecture.md) and the [package pages](./packages/index.md).

## How these docs are organised

| Section | What you find there |
| --- | --- |
| [Concepts](./concepts/architecture.md) | Why the shell is shaped the way it is: layering, guard, identity, messaging, bridges, [relay tiers](./concepts/relay-tiers.md), [persistence](./concepts/persistence.md), [layouts](./concepts/layouts.md), and what an applet meets. |
| [Tutorials](./tutorials/run-the-shell.md) | End-to-end walkthroughs that leave you with something running. |
| [How-tos](./how-tos/index.md) | One task each, with the exact calls. |
| [Troubleshooting](./guides/troubleshooting.md) | Failures people hit with this draft, and their fixes. |
| [Packages](./packages/index.md) | One page per package: version, install, exports, scope. |
| [API reference](./reference/api.md) and [error reasons](./reference/errors.md) | Generated from source JSDoc by TypeDoc; every reason string the packages throw. |
| [Decisions](./decisions.md) | The `D-NNN` decision log these pages cite. |
| [Changelog](./changelog.md) | What each release ships, per package and app, with its security changes and corrections. |
| [Policies](./policies/index.md) | Rules the repository enforces mechanically: vocabulary, security posture, spec conformance. |

Protocol vocabulary is used freely in these pages because they are written for developers. The public website and the shell UI follow a different rule, described in [Public vocabulary](./policies/public-vocabulary.md).

Agents reading this site should start at [Agent access](./agent-access.md).

## Licence and cost

kernl is free software under the MIT licence. Every package and the shell cost $0; there is no paid tier and no account to buy. During the alpha the source repository is private; the site, these docs and the [decisions](./decisions.md) are public at [kernlize.github.io](https://kernlize.github.io/).
