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

kehto's runtime ACL is permissive unless the host says otherwise: a capability with no entry in the ACL store is allowed. kernl says otherwise. `createShellAdapter` sets `aclDefaultPolicy: 'restrictive'` (`@kehto/shell` 0.32.0, [D-020](../decisions.md#d-020)), so an applet with no entry holds nothing, and a stored policy is replaced by this one on load while stored entries are kept. The posture is built in three places:

1. **ACL writes.** `KernlGrants.ensure(identity)` runs inside `kernl.plan`, before any frame exists. It commits the applet's record: every capability `BASELINE_DOMAINS` or an allowed domain needs is granted, and whatever the applet's stored entry holds beyond that is revoked (a domain the user took back, or an entry kept from the earlier permissive posture). Then the blocked flag is applied and the ACL persisted. An applet kernl never planned has no entry and is denied everything.
2. **Environment narrowing.** `createEnvironmentResolver(grants)` is the `ShellAdapter.capabilities.resolveEnvironment` hook. For each identity it returns the baseline plus the domains the user allowed, intersected with what the shell offers live; a blocked applet gets `shell` alone, enough to finish the handshake and nothing more. kehto intersects the result with its own availability set, so the hook can only remove. The applet's `shell.init` therefore advertises a subset.
3. **Runtime firewall rules.** `kernl.mount` calls `applyRuntimeFirewallRules`, which translates the guard profile's per-class rates into kehto's runtime firewall through `RUNTIME_OP_CLASSES` so that over-budget envelopes are refused before dispatch. It sets no policy: kehto's `allow` policy would skip every check, and deny and block are the grants layer's job. [Guard](./guard.md#where-enforcement-happens) has the translation table.

The baseline is `BASELINE_DOMAINS`: `shell`, `inc`, `theme` and `storage`. It has no network, and it is not read-only: the handshake, in-shell messaging, the theme, and the applet's own scoped storage, which it reads and writes within its state quota. Who the user is, is not in it. `identity` is a grant like any other ("your account" in the shell): until the user grants it, the shell does not tell an applet which account is signed in, its public key or its profile (SOUL opinion 2). Other grants can reveal the account indirectly, and the shell does not hide that: an applet granted `relay` that publishes gets the signed event back in `relay.publish.result`, and a signed event carries the author's public key. `grants.revokeDomain` refuses a baseline domain with `denied:baseline-domain`; `grants.allowDomain` refuses a domain the shell does not offer with `invalid:domain`, and is a no-op for a baseline domain.

The practical effect for an applet: `requires` in the manifest is honoured as a question, not a demand. `MountPlan.missingRequired` lists the required domains the environment does not include, and the host decides what to do before mounting; the web shell's launcher shows the required and optional domains as choices and calls `grants.allowDomain` for the ones the user turns on before it calls `kernl.plan`.

## Consent for destructive writes

Most writes an applet asks the shell to sign are additive: a note, a reaction, a comment. Some replace or erase the account's public record, and kernl asks before signing those. The check is kernl's, not kehto's: kehto's runtime has no consent step for destructive signing. `createKernl` builds one gate with `createSigningConsent` (`consent/handler.ts`) and puts both routes an applet's write can take through it:

- **`relay.publish`.** kehto signs through `ShellAdapter.auth.getSigner(windowId)`; the signer kernl returns for a window awaits the gate in `signEvent` before the account signs.
- **`outbox.publish`.** kehto's outbox service signs without naming the window, so kernl gates `outbox.publish` in the service wrapper (`kernl-services.ts`) before the message reaches the service; a refusal is answered as `outbox.publish.result` with `ok: false`.

`isDestructiveKind` accepts every replaceable kind (0, 3, 10000–19999), because signing one overwrites the version before it; every addressable kind (30000–39999), for the same reason; kind 5, a deletion; and kind 62, a request to vanish. For those, the gate first looks up the current version: `lookupReplaceable` reads the `EventStore` and, on a miss, asks the user's outbox and discovery relays through the applesauce address loader, waiting at most `CURRENT_VERSION_TIMEOUT_MS` (4000 ms). It then runs `describeChange(draft, before, applet)` (`consent/describe-change.ts`):

| Kind | Severity | What the user sees |
| --- | --- | --- |
| `0` | `destructive` | "Update your profile": one line per changed field, with the value before and after. |
| `3` | `destructive` | "Change who you follow": follows added and removed, counted, the first three named by abbreviated key. |
| `5` | `destructive` | "Delete N items", or "Delete N posts" when the `k` tags say every target is a post: one line per event id (`e` tag), and one "Delete every version of" line per address (`a` tag), named in plain words such as `record (type 30001) "books" by person 3bf0c63f…`. |
| `62` | `destructive` | "Ask services to erase your account": everything the account published, and which services are asked. |
| `10002` | `destructive` | "Change your inbox and outbox": a line saying what the two are, then relays added to and removed from each. An unmarked relay is both and appears in each (NIP-65). |
| 10000–10099, 30000–30099 | `destructive` | "Change the list …": entries added and removed, each named as a person, item, topic, type, server or key rather than as a raw tag. |
| any other replaceable or addressable kind | `destructive` | "Replace one of your records (type N)": tags added and removed, and "Content: Replaced" when the content changes, without copying it. |
| everything else | `routine` | No prompt; the event is signed without asking. |

When no current version is found, in the store or on the network within the timeout, a replaceable or addressable summary starts with "Current version: could not be loaded; this replaces it entirely" (`UNKNOWN_CURRENT_VERSION`), so the user is not shown a first version that seems to remove nothing.

The gate calls `host.presentConsent({ summary, resolve })` and waits. *Allow* signs the event. Deny or dismiss rejects with `denied:consent`: nothing is signed and nothing is published. The core never times a prompt out. A destructive write from a window kernl did not mount is refused with `denied:unknown-applet`, one while nobody is signed in with `denied:signed-out`, and a write whose kind is not a number with `invalid:event-kind`.

Three limits are deliberate:

- **Only applet windows are gated.** The shell's own signing, which has no window id, goes through the account's signer directly.
- **Answers are not remembered.** Each destructive write asks again; `ConsentPrompt` has no "always allow" switch.
- **The user never approves raw JSON.** The unsigned draft (empty `id` and `sig`) is on `ConsentSummary.event` for an "advanced" disclosure.

kehto's own `ConsentRequest` is a different thing: the runtime raises it, without an event, when a firewall policy is `prompt`. `createConsentHandler` is registered for it and refuses those without asking; a future request that carries an event, from a window the shell can name, would be described and put to the user. kernl sets no runtime policy except the momentary `deny` of `refuseCurrentDispatch`, and never `ask`, so the firewall path is not expected.

Deletions are not rate-limited more tightly than other publishes before dispatch: kind 5 shares the `relay:write` budget in kehto's runtime firewall. The guard's separate `relay:publish:delete` bucket runs only in kernl's own focus firewall, which observes each envelope before dispatch but cannot hold it, so an overrun becomes a guard event ([Guard](./guard.md#where-enforcement-happens)).

## What the applet learns

The applet learns its own narrowed environment through `shell.init`. Without the `identity` grant it is not told who is signed in. It does not learn why a domain is missing, whether other applets have it, or what the user's other grants are. The shell never gives it `window.nostr`, a key, the `EventStore`, or plaintext the user did not ask the shell to show it.

## Related

- [Guard](./guard.md): the behavioural limits that apply once a grant exists.
- [Grant and revoke](../how-tos/grant-and-revoke.md): the shell-side calls.
- [Security posture](../policies/security-posture.md): the mount rules this page relies on.
