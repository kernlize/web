# Identity and grants

An applet is not a name. It is a specific set of verified bytes, running in one frame, speaking over one port. Grants attach to that, and die with it.

## Identity

kehto binds an applet's identity to two things, and kernl keeps both:

1. **The verified artifact hash.** `resolveApplet` fetches the manifest event, verifies its signature, fetches the artifact bytes by SHA-256 and verifies them. The identity is `(dTag, artifactHash)`; `dTag` names the applet across versions, `artifactHash` names this build. Cached bytes are re-verified on every read. A gateway that serves different bytes produces a different hash, which is a different identity with no grants.
2. **The live message port.** The frame sends exactly one `napplet.hello` with exactly one transferred `MessagePort`. The bridge binds the identity to that port. Everything after the handshake travels over the port, never over `window.postMessage`.

The binding is revoked, the port closed and the iframe removed when the shell observes any of:

| Reason | Observation |
| --- | --- |
| `window-message` | A window-level message other than the one `napplet.hello`. |
| `second-hello` | A second `napplet.hello` from the same frame. |
| `invalid-hello` | A `hello` without exactly one transferred port. |
| `second-load` | The frame loaded a second document, by navigation or reload. |
| `port-closed` | The port closed or a message failed to deserialise. |
| `host` | The shell revoked the binding itself, for example when the user closed the window or quarantine ended in removal. |

A revoked window's identity can never be re-bound to the same iframe. Opening the applet again means a new frame, a new handshake and a fresh guard state. Grants, however, outlive the frame: they are keyed by identity, not by window.

## Grants

A grant is something the user gave and can take back. In kehto's `@kehto/acl` a grant is an entry keyed by `toKey({ dTag, hash })`, that is `"<dTag>:<hash>"`, carrying a capability bitmask, a blocked flag and a quota. kernl uses that store unchanged, with two consequences:

- **A new build is a new grant.** When the applet's author publishes a new artifact, the hash changes and the grants for the old hash do not apply. The shell shows the user what changed and asks again. This is deliberate: the user approved specific code, not a name.
- **Grants are per applet, never global.** There is no "allow all applets to publish" switch. The user decides per `(dTag, hash)`.

## Restrictive posture

kehto's `createRuntime` hardcodes the ACL default policy to `'permissive'`: a domain with no entry in the ACL store is allowed. kernl wants the opposite, and until the upstream gap in [Alpha status](../alpha-status.md#upstream-gaps) is closed it produces the restrictive posture in front of the runtime:

1. **Environment narrowing.** `ShellAdapter.capabilities.resolveEnvironment(identity, available)` runs at mount time. kernl returns, for each identity, only the domains the user has granted plus the domains that need no grant (`shell`, `theme`, `config`). kehto intersects the result with the live availability set, so this hook can only remove, never add. The applet's `shell.ready` therefore advertises a subset, and an applet that calls a domain it was not given gets `unavailable`, not a permissive pass.
2. **Explicit grants.** When the user grants a domain, kernl calls `aclState.grant(identity, cap)` and re-resolves the environment. The runtime's permissive default is never reached for a domain the user has not granted, because such a domain is never advertised.

The practical effect for an applet: `requires` in the manifest is honoured as a question, not a demand. The mount plan compares `requires` against what the user has granted for this identity; missing required domains produce a consent prompt before the frame is created, not a silent grant.

## Consent for destructive writes

Most writes an applet asks the shell to sign are additive: a note, a reaction, a list item. Four kinds replace or destroy state the user depends on, and kernl treats them differently:

| Kind | What it replaces | What the user sees |
| --- | --- | --- |
| `0` | Profile metadata | A field-by-field diff: name, about, picture, NIP-05, with removed fields marked. |
| `3` | Follow list | Added and removed follows by name, with the count before and after. |
| `5` | Deletion request | The events that would be deleted, rendered, with their age. |
| `10002` | Relay list (NIP-65) | Added and removed relays, read/write marker changes. |

`describeChange(current, proposed)` in `@kernl/core` produces these summaries as structured `ChangeDescription` values; the shell renders them as semantic diffs. The user never sees raw JSON as the thing they are approving. Each of these kinds also has its own tighter rate bucket (`relay:publish:delete` for kind 5) so a burst of destructive writes is throttled as well as prompted.

Consent is remembered per `(identity, kind)` only when the user asks for it to be, and a remembered consent is listed and revocable in the grants panel like any other grant.

## What the applet learns

The applet learns its own narrowed environment through `shell.ready`. It does not learn why a domain is missing, whether other applets have it, or what the user's other grants are. It never sees `window.nostr`, a key, or plaintext the user did not ask the shell to show it.

## Related

- [Guard](./guard.md): the behavioural limits that apply once a grant exists.
- [Grant and revoke](../how-tos/grant-and-revoke.md): the shell-side calls.
- [Security posture](../policies/security-posture.md): the mount rules this page relies on.
