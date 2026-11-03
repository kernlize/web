# Grant and revoke

A grant is something the user gave and can take back. This page covers what the shell asks, what each answer changes, and the `Kernl` calls behind the panel.

## What the user sees

**Before the first run.** After `kernl.resolve` verifies the applet, the launcher compares its `requires` and `optional` lists with the baseline and with what this identity already has (`kernl.grants.get(identity)`). Each domain is a switch: the baseline fixed on, everything else pre-set to what this identity was granted before, so a first run starts with every grantable switch off. That includes *your account* (`identity`) when the applet names it: an applet is not told who is signed in until the user turns that switch on, here or later in the grants panel. Required domains are marked as such and a warning names the ones still off. *Run* applies the switches with `allowDomain` and `revokeDomain`, then calls `kernl.plan`. A required domain left off appears in `MountPlan.missingRequired`; the applet mounts anyway and sees that domain as unavailable.

**During use.** kernl asks before signing a destructive change. Whether the applet publishes through `relay.publish` (signed through `ShellAdapter.auth.getSigner(windowId)`) or `outbox.publish` (gated in kernl's outbox service wrapper), the write passes `createSigningConsent`: for a destructive kind (any replaceable or addressable kind, a deletion or a request to vanish) it looks up the current version, in the event store and then on the outbox and discovery relays for up to 4 seconds, runs `describeChange` on the unsigned draft, calls `host.presentConsent` and waits. The host shows the title ("Update your profile", "Change who you follow", "Delete 2 posts" or "Delete 2 items", "Ask services to erase your account", "Change your connections list", "Change the list …", "Replace one of your records (type N)") and one line per change with the value before and after; when the current version could not be loaded, the first line says so. The applet is named by its display name and the short hash of its build. *Allow* resolves the prompt with `true` and the event is signed; dismissing it resolves `false`, the write fails with `denied:consent`, and nothing is signed or published. Routine writes (posts, reactions and other kinds outside the destructive set) are signed without a prompt, and the shell's own signing is never gated. Nothing is remembered; the next destructive write asks again. kehto's runtime has no destructive-signing consent of its own; this is kernl's.

**In the grants panel.** Every domain the shell offers, as a switch; a **Block applet** button (**Unblock applet** once blocked); and, when the guard has quarantined the window, **Release from quarantine**. The panel reads `kernl.grants.get(identity)` and re-renders on `kernl.grants.changes$`.

## What a grant is keyed by

`AppletIdentity`, `{ dTag, hash }`. A new build has a new hash and no grants; the launcher asks again, showing the new manifest's title, publisher and domains. See [Identity and grants](../concepts/identity-and-grants.md#grants).

## The calls

`kernl.grants` is the `Grants` interface; `createGrants` implements it over `bridge.runtime.aclState` with a record per identity at `kernl:grants:v1`.

```ts
import type { AppletIdentity, Kernl } from '@kernl/core';

declare const kernl: Kernl;
declare const identity: AppletIdentity;

kernl.grants.get(identity); // GrantRecord | undefined
kernl.grants.allowDomain(identity, 'relay'); // throws invalid:domain when the shell does not offer it
kernl.grants.revokeDomain(identity, 'relay'); // throws denied:baseline-domain for shell, inc, theme, storage
kernl.grants.block(identity);
kernl.grants.unblock(identity);
kernl.grants.setStateQuota(identity, 4096);
kernl.grants.availableDomains(); // what buildShellCapabilities(adapter) offers
kernl.grants.baselineDomains(); // ['shell', 'inc', 'theme', 'storage']

const subscription = kernl.grants.changes$.subscribe((record) => console.log(record.identity.dTag, record.domains));
subscription.unsubscribe();

for (const handle of kernl.applets()) {
  if (handle.summary.identity.hash === identity.hash) handle.close();
}
```

`GrantRecord` is `{ identity, domains, capabilities, blocked, stateQuotaBytes }`. `domains` are the ones the user allowed beyond the baseline; `capabilities` is `capabilitiesForDomains([...BASELINE_DOMAINS, ...domains])`.

Every change commits the record, which does three things in order: persist it to `kernl:grants:v1`, write the full capability set into kehto's ACL (each capability in `ALL_CAPABILITIES` granted or revoked explicitly, then `block` or `unblock`, then `acl.persist()`), and emit the new `GrantRecord` on `changes$`. A call that changes nothing (allowing a domain twice, revoking one that was never allowed, allowing a baseline domain) commits nothing and emits nothing.

- **`allowDomain`** refuses a domain the shell does not offer with `invalid:domain`. A newly allowed domain is in the ACL at once; a running applet was told its environment at mount and is not told again, so the domain appears in its `shell.init` the next time it is opened.
- **`revokeDomain`** refuses the baseline with `denied:baseline-domain`. The ACL loses the domain's capabilities at once, and kehto refuses the applet's next envelope that needs one of them.
- **`block`** keeps the record's domains but denies every capability in the ACL and makes `createEnvironmentResolver` advertise `shell` alone at the next mount. It does not close an open window, and neither does the panel; the open window keeps running under the ACL's denials until it is closed. **`unblock`** restores the record's capabilities.
- **`setStateQuota`** writes the quota for the `storage` domain into the ACL and emits a change.
- **`ensure(identity)`**, on the `KernlGrants` type the shell holds internally, is called by `kernl.plan` so an applet with no record still gets an explicit, baseline-only ACL entry.

## Closing and quarantine

Closing a window is `handle.close()`: `bridge.revokeNapplet(windowId, 'host')`, which closes the port and drops kehto's sessions for the frame, then the frame is removed and the guard forgets the window. Grants are untouched. When the guard quarantines a window, `createKernl`'s `onQuarantine` does the same and tells `host.onRevoked(windowId, 'quarantine')`; the grants panel's control for a quarantined window calls `kernl.guard.release(windowId)`.

## Bridges

A `resource` request from an applet that holds the `resource` domain is resolved by the bridge registry in the applet's name (`resourceInitFor`). The registry `createKernl` builds with `createDefaultBridges()` has no `authorize` hook, so the HTTP bridge's SSRF policy is the only check. A host that wants to ask per host or scheme passes its own registry, built with `createDefaultBridges({ authorize })`, in `KernlOptions.bridges`.

## What is never granted

- A loosened CSP. Not a grant; not possible.
- Access to `window.nostr`, raw keys or the `EventStore`.
- A global grant across applets.
- A grant by a developer flag or a URL parameter.
- A domain the shell does not serve. `DOMAIN_CAPABILITIES` has rows for `config`, `cvm`, `upload`, `intent`, `fs`, `llm` and `cache`, but `availableDomains()` does not list them and `allowDomain` refuses them with `invalid:domain`. (`keys` and `media` are listed, because kehto's runtime serves them natively, though kernl wires nothing behind them.)
