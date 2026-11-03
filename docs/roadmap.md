# Roadmap

Ordered by the tie-breakers in `SOUL.md`: the user's safety and agency first, protocol conformance second, the applet developer's ability to build third. Nothing here is dated. An item moves off this page when its scenarios pass and its docs exist.

## 1. Upstream pull requests to kehto

Both items shrink kernl when they land; see [Alpha status](./alpha-status.md#upstream-gaps).

- Forward `getFocusContext`, `onFirewallEvent` and `firewallPersistence` through `ShellAdapter` so the runtime's own firewall can be focus-aware without a second engine in front of it.
- Let the host choose the ACL default policy in `createRuntime`, so a restrictive shell does not have to rely on environment narrowing alone.

## 2. Bridge backends

Each backend plugs into the path the HTTP bridge already exercises end to end. Order reflects how much of the user's exposure each one changes; see [Bridges](./concepts/bridges.md).

| Backend | Interface | Notes |
| --- | --- | --- |
| Mail | `MailBackend` | Opens or creates a conversation for a `mailto:` locator. Candidate for a shell-side IMAP/JMAP client or a hand-off to a configured mail account. |
| NZB | `NzbBackend` | Hands an `nzb:` locator to a configured downloader. The downloader runs outside the browser; the bridge reports job state. |
| Torrent | `TorrentBackend` | Adds an info hash with its trackers. WebTorrent in the shell, or a configured external client. Marked as public activity in the exposure description. |
| Soulseek | `SoulseekBackend` | Requests one file from one peer. Requires a daemon; the bridge reports job state. |

## 3. Messaging

- Supply the double-ratchet runtime so the `ratchet` provider reports `available`. Its properties are already described; see [Messaging](./concepts/messaging.md).
- Per-conversation provider migration: move a correspondent from `legacy` to `private` when both clients can read it, shown as a reversible choice.

## 4. Mobile layouts

The window manager contracts come from `@kehto/wm`. A narrow-viewport layout with a window switcher, gestures for focus and dismissal, and the same visibility semantics the guard relies on (a window off screen is hidden, and hidden windows are deferred).

## 5. Account switching

`AccountManager` already holds several accounts. The missing piece is a switcher that makes the active account visible on every screen, keeps grants scoped to the account that gave them, and never signs a write with an account the user did not pick for that window.

## 6. Guard

- Persist per-applet profile overrides and grants through a user-chosen sync, so loosening an applet once does not have to be repeated per device.
- A readable guard log in the shell: every `defer`, `reject`, `quarantine` and `flag` event, with the stable reason and the applet it concerned.

## Not planned

- A global configuration flag that loosens a mitigation for every applet. `SOUL.md` opinion three rules it out.
- A second event library beside applesauce. `DECISIONS.md` D-002 rules it out.
- A "recommended" messaging provider. D-009 rules it out.
