# Roadmap

Ordered by the tie-breakers in `SOUL.md`: the user's safety and agency first, protocol conformance second, the applet developer's ability to build third. Nothing here is dated. An item moves off this page when its scenarios pass and its docs exist.

## 1. Upstream pull requests to kehto

The four gaps filed as [kehto/web #397](https://github.com/kehto/web/issues/397), [#398](https://github.com/kehto/web/issues/398), [#399](https://github.com/kehto/web/issues/399) and [#400](https://github.com/kehto/web/issues/400) are released and in use ([D-020](./decisions.md#d-020)). What is left:

- Follow [kehto/web#336](https://github.com/kehto/web/pull/336) when it is released. It makes kehto's firewall a shared approval authority and moves rate limiting into a separate runtime budget. kernl will move `packages/core/src/guard/runtime-rules.ts` from the firewall setters, `onFirewallEvent` and `firewallPersistence` to `permissions.setRateLimit` and `onRateLimit`, drop `kernl:firewall:v1`, and decide how admission approvals meet the restrictive ACL. `getFocusContext`, `aclDefaultPolicy`, `filterNappletMessage` and `releaseDeferred` stay.
- Ask for an event when a stored deny refuses a request on a host that configures #336's permissions, so the host can show it; until then kernl's own guard layers report what they refuse.
- Ask for a reply kehto can send for a request the host drops, so an applet does not wait for an answer that will not come. NAP defines none today.
- Let the runtime measure envelopes without an `event`, so its size limits see downloads and queries and kernl's size caps could move into kehto.
- Report the four creation routes past `experimental.nestedContextLock` and ask kehto to guard insertion, so kernl can drop its insertion lock ([D-014](./decisions.md#d-014)).

## 2. Bridge backends

Magnet links download inside the shell page through WebTorrent, with the device app as a choice in Settings ([D-017](./decisions.md#d-017)). The NZB, Soulseek and mail bridges still hand the locator to an app on the user's device ([Bridges](./concepts/bridges.md#hand-off-backends)), because each of their protocols runs over raw TCP sockets and a browser page cannot open one ([Why they still hand off](./concepts/bridges.md#why-nzb-soulseek-and-mail-still-hand-off)).

The next step is a **companion service**: a small program the user runs on their own device, or a service they choose, that opens those sockets on the user's behalf and that the shell reaches over a WebSocket. Each bridge then gets an in-shell backend that talks to it. In-shell transfers put the traffic under the shell's grants, guard and revocation, and make it the shell's to expose, so each needs its exposure description checked. Order reflects how much of the user's exposure each one changes.

| Backend | Interface | Notes |
| --- | --- | --- |
| Mail | `MailBackend` | Opens or creates a conversation for a `mailto:` locator inside the shell. Needs the companion service for IMAP and SMTP, or a provider with a JMAP endpoint that allows cross-origin requests. Today the device's mail program opens. |
| NZB | `NzbBackend` | Hands an `nzb:` locator to the companion service, which fetches from the user's news server; the bridge reports job state in the Downloads panel. Today the `https` document URL opens on the device. |
| Soulseek | `SoulseekBackend` | Requests one file from one peer through the companion service; the bridge reports job state. Today the `slsk://` address opens on the device. |
| Torrent | `TorrentBackend` | Done for browser peers ([Downloads inside kernl](./concepts/bridges.md#downloads-inside-kernl)). A companion service could also reach peers that only speak TCP and UDP, which browser peers cannot. |

The Downloads panel shows in-kernl jobs only; a hand-off job cannot be tracked, because the transfer belongs to the device app. Downloads live in memory and end when the tab closes; keeping them across reloads is open.

## 3. Messaging

- Ratchet sessions: persist the conversation list sealed like the session state, read correspondents' inbox relays, and offer groups ([D-016](./decisions.md#d-016)).
- Group sessions: keep each group's history sealed across reloads, let the user name a group, add and remove members and leave, read correspondents' key-package relay lists (kind 10051), and follow the group library out of alpha ([D-018](./decisions.md#d-018)).
- Private messages: read NIP-17 kind 15 file messages, which `private` skips today.
- Inbox setup: offer to publish the user's kind 10050 inbox relays when they have none, so `private` stops falling back to the `outbox` and `super` tiers ([D-015](./decisions.md#d-015)).
- Per-conversation provider migration: move a correspondent from `legacy` to `private` when both clients can read it, shown as a reversible choice.

## 4. Mobile layouts

The window manager contracts come from `@kehto/wm`. A narrow-viewport layout with a window switcher, gestures for focus and dismissal, and the same visibility semantics the guard relies on (a window off screen is hidden, and hidden windows are deferred).

## 5. Account switching

`AccountManager` already holds several accounts. The missing piece is a switcher that makes the active account visible on every screen, keeps grants scoped to the account that gave them, and never signs a write with an account the user did not pick for that window.

## 6. Guard

- Per-applet guard profiles: today the profile is shell-wide and resets to `strict` on boot ([D-003](./decisions.md#d-003)). Next: an override per applet identity, remembered locally.
- Re-narrow a live applet's advertised environment when a domain is revoked; today the ACL denies at once but `shell.init` only changes on the next open.
- Bridge consent per host: wire `createDefaultBridges({ authorize })` to a host prompt so a granted `resource` request still asks before reaching a new origin.
- Persist per-applet profile overrides and grants through a user-chosen sync, so loosening an applet once does not have to be repeated per device.

## 7. Conformance

- Run `@napplet/conformance` against the shell's bridge in `pnpm test`: envelope validators per NAP domain, manifest validation and the reference mock shell's expectations of a host. Today conformance is checked by the `packages/*/features/` scenarios and review only ([Spec conformance](./policies/spec-conformance.md)).

## Not planned

- A flag in the hosted shell that turns a mitigation off or loosens it for every applet without the user. `SOUL.md` opinion three rules it out. `KernlOptions.guard.profile` lets an embedding host pick the starting limits only.
- A second event library beside applesauce. `DECISIONS.md` [D-002](./decisions.md#d-002) rules it out.
- A "recommended" messaging provider. [D-009](./decisions.md#d-009) rules it out.
