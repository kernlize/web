# Grant and revoke

A grant is something the user gave and can take back. This page covers what the shell asks, what each answer changes, and the calls behind the panel.

## What the user sees

**At mount.** The applet's `requires` list is compared with what this identity already has. Each missing domain produces one line in a single prompt: the domain's user-facing name, one sentence on what it lets the applet do, and whether it can write on the user's behalf. Decline any required domain and the applet does not mount. Optional domains are not asked for at mount; they appear in the grants panel as switches.

**During use.** Three things prompt while an applet runs:

| Prompt | Trigger | Shown as |
| --- | --- | --- |
| Destructive write | A publish of kind 0, 3, 5 or 10002 | A semantic diff from `describeChange`: what is added, removed, changed. |
| Bridge request | A `resource` request routed to a bridge for a host or scheme not yet allowed for this identity | The locator, the bridge's label and exposure, the requesting applet. |
| Optional domain | The applet calls a domain it lists as optional and does not have | A one-line request with *Allow*, *Not now*, *Never for this applet*. |

Every prompt names the applet by its display name and shows the short hash of the build, so an update is visible as an update.

**In the grants panel.** Everything granted for the identity, in one list: domains, remembered consents per kind, allowed bridge hosts, the guard profile. Each row has *Revoke*. The panel has *Revoke all*, which also closes the window.

## What a grant is keyed by

`(dTag, artifactHash)`. A new build has a new hash and no grants. The shell shows the diff between the old manifest and the new one (name, `requires`, `optional`, author) and asks again. See [Identity and grants](../concepts/identity-and-grants.md#grants).

## The calls

`@kernl/core` exposes the grants surface the panel uses. All of it is behind an interface so the implementation can shrink when the upstream ACL default becomes configurable.

```ts
const grants = kernl.grants;

grants.list(identity);
// → [{ kind: 'domain', domain: 'relay' }, { kind: 'consent', eventKind: 3 }, { kind: 'host', host: 'cdn.example.org', bridge: 'http' }]

await grants.grant(identity, { kind: 'domain', domain: 'outbox' });
await grants.revoke(identity, { kind: 'domain', domain: 'outbox' });
await grants.revokeAll(identity);
```

`grant` for a domain does three things in order: `aclState.grant(identity, cap)` in kehto's ACL store, a re-resolution of the environment so `resolveEnvironment` now returns the domain, and a persistence write. The applet's next `shell.ready` or domain call sees the domain. `revoke` reverses the three; the applet's next call to that domain returns `unavailable`, and any live subscription on that domain is closed by the service.

`revokeAll` additionally calls `bridge.revokeNapplet(windowId, 'host')`, which closes the port and removes the frame.

## Remembered consent

A destructive-write prompt has *Allow once* and *Always allow kind N for this applet*. The second writes a `consent` grant keyed by `(identity, kind)`. It is listed in the panel and revocable. There is no "always allow everything". The shell never remembers consent for kind 5 deletions beyond the current session, because deletions are the one write the user cannot undo by publishing again.

## Blocking

*Never for this applet* on any prompt calls `aclState.block(identity)`. A blocked identity's frame is removed, its grants are kept but inert, and opening the same address shows the block with an *Unblock* control. Blocking is per hash like everything else; a new build asks fresh, and the panel says the previous build was blocked.

## What is never granted

- A loosened CSP. Not a grant; not possible.
- Access to `window.nostr`, raw keys or the `EventStore`.
- A global grant across applets.
- A grant by a developer flag or a URL parameter.
