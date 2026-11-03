# Identity and grants

An applet is not a name. It is a specific set of verified bytes, running in one frame, speaking over one port. Grants attach to that, and die with it.

## Identity

kehto binds an applet's identity to two things, and kernl keeps both:

1. **The verified artifact hash.** `kernl.resolve` fetches the manifest event, verifies its signature, fetches the artifact bytes by SHA-256 and verifies them through kehto's `resolveNapplet` (`applets/resolve.ts`). The identity is `AppletIdentity`, `{ dTag, hash }`: `dTag` names the applet across versions, `hash` is kehto's `aggregateHash` and names this build. Cached bytes are re-hashed on every read. A gateway that serves different bytes produces a different hash, which is a different identity with no grants.
2. **The live message port.** The frame sends exactly one `napplet.hello` with exactly one transferred `MessagePort`. The bridge binds the identity to that port. Everything after the handshake travels over the port, never over `window.postMessage`.

The binding is revoked, the port closed and the iframe removed when the shell observes any of:

| Reason | Observation |
| --- | --- |
| `window-message` | A window-level message other than the one `napplet.hello`. |
| `second-hello` | A second `napplet.hello` from the same frame. |
| `invalid-hello` | A `hello` without exactly one transferred port. |
| `second-load` | The frame loaded a second document, by navigation or reload. |
| `port-closed` | The port closed or a message failed to deserialise. |
| `host` | The shell revoked the binding itself: the user closed the window (`handle.close()`), or the guard quarantined it, in which case `host.onRevoked` is told `quarantine`. |

A revoked window's identity can never be re-bound to the same iframe. Opening the applet again means a new frame, a new handshake and a fresh guard state. Grants, however, outlive the frame: they are keyed by identity, not by window.

## Grants

A grant is something the user gave and can take back. kehto's ACL holds, per `dTag:hash`, a capability set, a blocked flag and a state quota. kernl's `createGrants` (`grants/grants.ts`) keeps its own record per identity, `{ dTag, hash, domains, blocked }`, at `kernl:grants:v1`, and mirrors it into the ACL on every change. Two consequences:

- **A new build is a new grant.** When the applet's author publishes a new artifact, the hash changes and the grants for the old hash do not apply. The user approved specific code, not a name.
- **Grants are per applet, never global.** There is no "allow all applets to publish" switch. The user decides per `(dTag, hash)`, domain by domain.

A grant is expressed in domains, not capabilities. `DOMAIN_CAPABILITIES` (`grants/domain-capabilities.ts`) says which kehto capabilities a domain needs (`relay` is `relay:read` and `relay:write`; `shell` and `inc` need none), so the user is asked about `relay`, and the ACL receives both capabilities. The table is on the [core package page](../packages/core.md#grants).

## Restrictive posture

kehto's `createRuntime` hardcodes the ACL default policy to `'permissive'`: a capability with no entry in the ACL store is allowed. kernl wants the opposite, and until the upstream gap in [Alpha status](../alpha-status.md#upstream-gaps) is closed it produces the restrictive posture around the runtime in three places:

1. **Explicit ACL writes.** `KernlGrants.ensure(identity)` runs inside `kernl.plan`, before any frame exists. It commits the applet's record, and a commit writes the complete capability set: every capability in kehto's `ALL_CAPABILITIES` is granted when `BASELINE_DOMAINS` or an allowed domain needs it and revoked otherwise, then the blocked flag is applied and the ACL persisted. The permissive default is never consulted for an applet kernl runs, because every capability has an entry.
2. **Environment narrowing.** `createEnvironmentResolver(grants)` is the `ShellAdapter.capabilities.resolveEnvironment` hook. For each identity it returns the baseline plus the domains the user allowed, intersected with what the shell offers live; a blocked applet gets `shell` alone, enough to finish the handshake and nothing more. kehto intersects the result with its own availability set, so the hook can only remove. The applet's `shell.init` therefore advertises a subset.
3. **Runtime firewall rules.** `kernl.mount` calls `applyRuntimeFirewallRules`, which translates the guard profile's per-class rates into kehto's runtime firewall through `RUNTIME_OP_CLASSES` so that over-budget envelopes are refused before dispatch. The policy it sets is `allow`; deny and block are the grants layer's job. [Guard](./guard.md#where-enforcement-happens) has the translation table.

The baseline is `BASELINE_DOMAINS`: `shell`, `inc`, `theme`, `identity` and `storage`. It is read-only and has no network: the handshake, in-shell messaging, the theme, the user's public key and profile, and scoped storage. `grants.revokeDomain` refuses a baseline domain with `denied:baseline-domain`; `grants.allowDomain` refuses a domain the shell does not offer with `invalid:domain`, and is a no-op for a baseline domain.

The practical effect for an applet: `requires` in the manifest is honoured as a question, not a demand. `MountPlan.missingRequired` lists the required domains the environment does not include, and the host decides what to do before mounting; the web shell's launcher shows the required and optional domains as choices and calls `grants.allowDomain` for the ones the user turns on before it calls `kernl.plan`.

## Consent for destructive writes

Most writes an applet asks the shell to sign are additive: a note, a reaction, a list item. Some replace or erase the account's public record, and kernl shows those as what they change. kehto raises a `ConsentRequest` for destructive signing kinds; `createConsentHandler` (`consent/handler.ts`) finds the current version of the replaceable event in the `EventStore` and asks `host.presentConsent` with the summary from `describeChange(event, before, applet)` (`consent/describe-change.ts`):

| Kind | Severity | What the user sees |
| --- | --- | --- |
| `0` | `destructive` | "Update your profile": one line per changed field, with the value before and after. |
| `3` | `destructive` | "Change who you follow": follows added and removed, counted, the first three named by abbreviated key. |
| `5` | `destructive` | "Delete N events": one line per event id. |
| `10002` | `destructive` | "Change your connections list": relays added and removed with their read/write markers. |
| 10000–10099, 30000–30099 | `destructive` | "Change the list …": entries added and removed. |
| everything else | `routine` | "Publish a note" (or repost, reaction, comment, article, …): a 140-character preview of the content. |

The user never sees raw JSON as the thing they are approving; the raw event is on `ConsentSummary.event` for an "advanced" disclosure. A request without an event (kehto's `firewall-policy` prompt) or from a window the shell cannot name is refused without asking: kernl never signs for an applet it cannot identify. Kind 5 also has its own, tighter rate bucket (`relay:publish:delete`) in the guard, so a burst of deletions is throttled as well as prompted.

Consent is answered per request in this draft. Nothing in `@kernl/core` remembers an answer, and `ConsentPrompt` has no "always allow" switch.

## What the applet learns

The applet learns its own narrowed environment through `shell.init`. It does not learn why a domain is missing, whether other applets have it, or what the user's other grants are. It never sees `window.nostr`, a key, the `EventStore`, or plaintext the user did not ask the shell to show it.

## Related

- [Guard](./guard.md): the behavioural limits that apply once a grant exists.
- [Grant and revoke](../how-tos/grant-and-revoke.md): the shell-side calls.
- [Security posture](../policies/security-posture.md): the mount rules this page relies on.
