# Grant and revoke

A grant is something the user gave and can take back. This page covers what the shell asks, what each answer changes, and the `Kernl` calls behind the panel.

## What the user sees

**Before the first run.** After `kernl.resolve` verifies the applet, the launcher compares its `requires` and `optional` lists with the baseline and with what this identity already has (`kernl.grants.get(identity)`). Each domain is a switch in a group ([D-060](../decisions.md#d-060)): the baseline fixed on, **Required** domains on and fixed, **Optional** ones pre-set to what this identity was granted before, so a first run starts with every optional switch off. An applet that requires *your account* (`identity`) is therefore told who is signed in once the person runs it. If the applet requires `dm` and also requires a domain the seal withholds (`upload`, `relay`, …), that domain moves to an **Unsafe with messages** group at the top, off until the person allows it. *Run* applies the switches with `allowDomain` and `revokeDomain`, then calls `kernl.plan`. A required domain this shell cannot offer, or an unsafe one left off, appears in `MountPlan.missingRequired`; the applet mounts anyway and sees that domain as unavailable. **Remember grants**, on unless the person turned it off, decides whether the choices are kept: off, they are in force for this run only and are dropped when the applet's last window ends. The checkbox is itself remembered.

**Messages seal an applet.** When *messages* is switched on, every switch for something that could send a message somewhere else is off and cannot be turned on: the network, posting, uploads, direct connections, remote tools, web fetches, links, language models, files and talking to other applets. The rows say *off while it can read your messages*. Your account, the theme, its own storage and settings, notifications, keyboard shortcuts and being opened by another applet stay available. Switching messages off puts the other grants back in force ([D-046](../decisions.md#d-046)).

**During use.** kernl asks before signing a destructive change. Whether the applet publishes through `relay.publish` (signed through `ShellAdapter.auth.getSigner(windowId)`) or `outbox.publish` (gated in kernl's outbox service wrapper), the write passes `createSigningConsent`: for a destructive kind (any replaceable or addressable kind, a deletion or a request to vanish) it looks up the current version, in the event store and then on the outbox and discovery relays for up to 4 seconds, runs `describeChange` on the unsigned draft, calls `host.presentConsent` and waits. The host shows the title ("Update your profile", "Change who you follow", "Delete 2 posts" or "Delete 2 items", "Ask services to erase your account", "Change your inbox and outbox", "Change the list …", "Replace one of your records (type N)") and one line per change with the value before and after; when the current version could not be loaded, the first line says so. The applet is named by its display name and the short hash of its build. *Allow* resolves the prompt with `true` and the event is signed; dismissing it resolves `false`, the write fails with `denied:consent`, and nothing is signed or published. Routine writes (posts, reactions and other kinds outside the destructive set) are signed without a prompt, and the shell's own signing is never gated. Nothing is remembered; the next destructive write asks again. kehto's runtime has no destructive-signing consent of its own; this is kernl's.

**Links ask, through the firewall.** A grant says an applet holds a domain; kehto's firewall decides, inside that, what goes ahead without asking. As shipped, everything granted goes ahead and each link an applet opens outside the shell asks first, with "Open link" and "Don't open". The user changes that in the **Firewall** panel ([Change the firewall rules](./change-firewall-rules.md)).

**In the grants panel.** Every domain the shell offers, as a switch; a **Block applet** button (**Unblock applet** once blocked); and, when the guard has quarantined the window, **Release from quarantine**. The panel reads `kernl.grants.get(identity)` and re-renders on `kernl.grants.changes$`.

## What a grant is keyed by

`AppletIdentity`, `{ dTag, hash }`. A new build has a new hash and no grants; the launcher asks again, showing the new manifest's title, publisher and domains. See [Identity and grants](../concepts/identity-and-grants.md#grants).

## The calls

`kernl.grants` is the `Grants` interface; `createGrants` implements it over `bridge.runtime.aclState` with a record per identity at `kernl:grants:v1`.

```ts
import type { AppletIdentity, Kernl } from '@kernlize/core';

declare const kernl: Kernl;
declare const identity: AppletIdentity;

kernl.grants.get(identity); // GrantRecord | undefined
kernl.grants.allowDomain(identity, 'relay'); // throws invalid:domain when the shell does not offer it
kernl.grants.allowDomain(identity, 'upload', { unsafe: true }); // keep it beside messages, which would withhold it
kernl.grants.allowDomain(identity, 'notify', { remember: false }); // for now: in force, never stored
kernl.grants.forgetTemporary(identity); // drop what was granted for now
kernl.grants.revokeDomain(identity, 'relay'); // throws denied:baseline-domain for shell, inc, theme, storage
kernl.grants.block(identity);
kernl.grants.unblock(identity);
kernl.grants.setStateQuota(identity, 4096);
kernl.grants.availableDomains(); // what buildShellCapabilities(adapter) offers
kernl.grants.baselineDomains(); // ['shell', 'inc', 'theme', 'storage', 'keys']

const subscription = kernl.grants.changes$.subscribe((record) => console.log(record.identity.dTag, record.domains));
subscription.unsubscribe();

for (const handle of kernl.applets()) {
  if (handle.summary.identity.hash === identity.hash) handle.close();
}
```

`GrantRecord` is `{ identity, domains, unsafe, capabilities, withheld, blocked, temporary, stateQuotaBytes }`. `domains` are the ones the user allowed beyond the baseline; `capabilities` is `capabilitiesInForce(domains, unsafe)`. An applet that holds `dm` is sealed: only `MESSAGE_COMPANION_DOMAINS` stay in force, `intent` keeps `intent:read` alone, and every other domain it was allowed, with the baseline's `inc`, is listed in `withheld` and is neither in its ACL entry nor in its environment ([D-046](../decisions.md#d-046)), unless the person chose to keep that domain beside messages: those are `unsafe`, and stay in force ([D-060](../decisions.md#d-060)). `intent:write` is withheld whatever is kept. `temporary` is true while some of the record was granted for now and is not stored.

Every change commits the record, which does three things in order: persist it to `kernl:grants:v1`, write it into kehto's restrictive ACL (each capability the record needs granted, whatever the applet's entry holds beyond that revoked, then `block` or `unblock`, then `acl.persist()`), and emit the new `GrantRecord` on `changes$`. A call that changes nothing (allowing a domain twice, revoking one that was never allowed, allowing a baseline domain) commits nothing and emits nothing.

- **`allowDomain`** takes `{ unsafe, remember }`. `unsafe: true` keeps the domain in force beside messages and `unsafe: false` drops that exception and keeps the grant; only the person's own action may set it, never an applet's manifest. `remember: false` grants for now: an in-memory record that takes precedence over the stored one and is never written, not even through kehto's ACL persistence. It refuses a domain the shell does not offer with `invalid:domain`. A newly allowed domain is in the ACL at once; a running applet was told its environment at mount and is not told again, so the domain appears in its `shell.init` the next time it is opened.
- **`forgetTemporary`** drops what was granted or taken back for now and puts the stored record back in force; kernl calls it when the last window of an applet ends, counting a window that is planned and not yet mounted, so an applet that starts again keeps its grants across the gap.
- **`revokeDomain`** takes `{ remember }`. It refuses the baseline with `denied:baseline-domain`, unless the person kept it beside messages, when it ends that exception. It also takes the domain's exception back. The ACL loses the domain's capabilities at once. Every open window of that applet that was started with the domain is stopped, and the host hears `grant-narrowed`, because a running window keeps the environment it was started with ([D-038](../decisions.md#d-038)). Granting a domain stops nothing; the applet sees it the next time it opens.
- **`block`** keeps the record's domains but denies every capability in the ACL and makes `createEnvironmentResolver` advertise `shell` alone at the next mount. Every open window of that applet is stopped, and the host hears `blocked` ([D-038](../decisions.md#d-038)). **`unblock`** restores the record's capabilities.
- **`setStateQuota`** writes the quota for the `storage` domain into the ACL and emits a change.
- **`ensure(identity)`**, on the `KernlGrants` type the shell holds internally, is called by `kernl.plan` so an applet with no record still gets an explicit, baseline-only ACL entry.

## Closing and quarantine

Closing a window is `handle.close()`: `bridge.revokeNapplet(windowId, 'host')`, which closes the port and drops kehto's sessions for the frame, then the frame is removed and the guard forgets the window. Grants are untouched. When the guard quarantines a window, `createKernl`'s `onQuarantine` does the same and tells `host.onRevoked(windowId, 'quarantine', { limit })`, where `limit` names the guard limit crossed; the grants panel's control for a quarantined window calls `kernl.guard.release(windowId)`.

## Bridges

A `resource` request from an applet that holds the `resource` domain is resolved by the bridge registry in the applet's name (`resourceInitFor`). The registry `createKernl` builds with `createDefaultBridges()` has no `authorize` hook, so the HTTP bridge's SSRF policy is the only check. A host that wants to ask per host or scheme passes its own registry, built with `createDefaultBridges({ authorize })`, in `KernlOptions.bridges`.

## What is never granted

- A loosened CSP. Not a grant; not possible.
- Access to `window.nostr`, raw keys or the `EventStore`.
- A global grant across applets.
- A grant by a developer flag or a URL parameter.
- A domain the shell does not serve. `DOMAIN_CAPABILITIES` has rows for `fs`, `llm` and `cache`, but `availableDomains()` does not list them, nor `config` when the host has no `presentSettings`, and `allowDomain` refuses them with `invalid:domain`. (`keys` and `media` are listed, because kehto's runtime serves them natively, though kernl wires nothing behind them.) `torrent`, `nzb` and `soulseek` are refused the same way until the shell can offer them ([Connected programs](../concepts/download-programs.md#when-the-domains-are-offered)).
