# Roadmap

Ordered by the tie-breakers in `SOUL.md`: the user's safety and agency first, protocol conformance second, the applet developer's ability to build third. Nothing here is dated. An item moves off this page when its scenarios pass and its docs exist.

## 1. Upstream pull requests to kehto

The four gaps filed as [kehto/web #397](https://github.com/kehto/web/issues/397), [#398](https://github.com/kehto/web/issues/398), [#399](https://github.com/kehto/web/issues/399) and [#400](https://github.com/kehto/web/issues/400) are released and in use ([D-020](./decisions.md#d-020)). What is left:

- Ask for an event when a stored deny refuses a request, so the host can show it. kernl configures kehto's `permissions` now ([D-056](./decisions.md#d-056)), and a refusal by a `deny` rule or a stored answer reaches the applet without a guard event.
- Ask for a reply kehto can send for a request the host drops, so an applet does not wait for an answer that will not come. NAP defines none today.
- Let the runtime measure envelopes without an `event`, so its size limits see downloads and queries and kernl's size caps could move into kehto.
- Report the four creation routes past `experimental.nestedContextLock` and ask kehto to guard insertion, so kernl can drop its insertion lock ([D-014](./decisions.md#d-014)).

## 2. Bridge backends

Applets work through the programs the person already runs, to add and control torrents, NZB jobs and Soulseek searches and transfers: Transmission or uTorrent, NZBGet or SABnzbd, and slskd, each driven over its own HTTP API behind the `torrent`, `nzb` and `soulseek` domains ([D-050](./decisions.md#d-050), [Connected programs](./concepts/download-programs.md)). This overtakes most of what this section used to plan, a companion service that would open sockets for the shell: for downloads, those programs already open them. What is left, in order:

- **A kehto release that lets the domains be offered.** The three are offered only when the installed `@kehto/shell` prelude renders a binding table ([kehto/web#413](https://github.com/kehto/web/pull/413)), which 0.35 does not. Until then the settings exist and no applet can call the services. When it ships, kernl takes the binding types from kehto and drops its local declaration.
- **File reads and saves.** The services are remote controls. `torrent.read`, `exportMetainfo`, `saveFile` and `openFile`, `nzb.files` and `nzb.read`, and `soulseek.read` and `soulseek.save` are refused, because the files are on the program's disk and kernl cannot reach them. Serving them needs a keeper with file access: a service on the person's device, or a native host.
- **Links the person opens.** The Downloads panel and the locator bridges do not use the programs yet. A magnet link still downloads in the page through WebTorrent, which reaches browser peers only, or is handed to an app on the device ([D-017](./decisions.md#d-017)); an NZB or Soulseek link is still handed off ([Bridges](./concepts/bridges.md#hand-off-backends)). A `TorrentBackend`, `NzbBackend` and `SoulseekBackend` over the same clients would give those links a job the panel can track, and reach peers a page cannot.
- **Seeding and uploading through a connection.** NAP-UPLOAD is not wired to these programs yet. When it is, and the person has more than one torrent connection, the prompt sequence for an upload or a seed (NAP-TORRENT's `pickFiles` and `runtime-file-set` sources) asks which connection to seed from, rather than routing it as downloads are ([D-053](./decisions.md#d-053)). NZB and Soulseek are out of scope for this: NAP-NZB has no upload or posting surface, and NAP-SOULSEEK does not expose local share administration or unsolicited uploads, whatever the daemon itself can do.
- **Verification.** The uTorrent adapter follows the documented WebUI API and has not been run against the program. slskd's search, browse and transfers were run between two daemons on a local Soulfind server, not the public network.
- **Secrets.** Move the connection helpers' credentials, which `kernl:multiplayer:v1` holds as typed ([D-043](./decisions.md#d-043)), behind the secrets provider. Ship a provider that protects what it keeps, so the default on kernl.run is no longer the browser's storage as typed ([D-052](./decisions.md#d-052), [Secrets](./concepts/secrets.md)).

Mail is unchanged:

| Backend | Interface | Notes |
| --- | --- | --- |
| Mail | `MailBackend` | Opens or creates a conversation for a `mailto:` locator inside the shell. Needs a service that speaks IMAP and SMTP for the person, or a provider with a JMAP endpoint that allows cross-origin requests. Today the device's mail program opens. |

The Downloads panel shows in-kernl jobs only; a hand-off job cannot be tracked, because the transfer belongs to the device app. Downloads live in memory and end when the tab closes; keeping them across reloads is open.

## 3. Messaging

- Ratchet sessions: persist the conversation list sealed like the session state, read correspondents' inbox relays, and offer groups ([D-016](./decisions.md#d-016)).
- Group sessions: keep each group's history sealed across reloads, let the user name a group, add and remove members and leave, read correspondents' key-package relay lists (kind 10051), and follow the group library out of alpha ([D-018](./decisions.md#d-018)).
- Private messages: read NIP-17 kind 15 file messages, which `private` skips today.
- Inbox setup: offer to publish the user's kind 10050 inbox relays when they have none, so `private` stops falling back to the `outbox` and `super` tiers ([D-015](./decisions.md#d-015)).
- Per-conversation provider migration: move a correspondent from `legacy` to `private` when both clients can read it, shown as a reversible choice.
- Show which provider carried a message. The applet sees opaque ids and cannot say; the shell knows, and should mark a conversation's window or a sent message when it used something other than the first provider ([D-027](./decisions.md#d-027)).
- Messages applet: take `napplet:dm/open` requests from other applets and open the conversation they name, once its SDK has the delivery hook; publish it to the store so other shells can run it; names and pictures for people, which the shell could fill in on `DmPeer` from profiles it already holds.
- Tell open applets when the shell's theme is switched, through the theme service's broadcast.

## 4. Mobile layouts

The window manager contracts come from `@kehto/wm`. A narrow-viewport layout with a window switcher, gestures for focus and dismissal, and the same visibility semantics the guard relies on (a window off screen is hidden, and hidden windows are deferred).

## 5. Account switching

`AccountManager` already holds several accounts. The missing piece is a switcher that makes the active account visible on every screen, keeps grants scoped to the account that gave them, and never signs a write with an account the user did not pick for that window.

## 6. Guard

- Per-applet guard profiles: today the profile is shell-wide and resets to `strict` on boot ([D-003](./decisions.md#d-003)). Next: an override per applet identity, remembered locally.
- Bridge consent per host: wire `createDefaultBridges({ authorize })` to a host prompt so a granted `resource` request still asks before reaching a new origin. The firewall already sees a download's first origin and asks about it when a rule says so; the origins a download is redirected to should reach it too, which today the bridge registry follows under its own address policy ([D-056](./decisions.md#d-056)).
- Firewall plans that name what a request reaches: the recipient's inboxes for a message, where the plan today names every relay in the shell's tiers, and an upload's mirrors, where it names the first file server only.
- Per-applet firewall rules in the panel beyond links. `kernl.firewall.setRule` already takes them ([Change the firewall rules](./how-tos/change-firewall-rules.md)).
- Persist per-applet profile overrides and grants through a user-chosen sync, so loosening an applet once does not have to be repeated per device.

## 7. Conformance

- Run `@napplet/conformance` against the shell's bridge in `pnpm test`: envelope validators per NAP domain, manifest validation and the reference mock shell's expectations of a host. Today conformance is checked by the `packages/*/features/` scenarios and review only ([Spec conformance](./policies/spec-conformance.md)).

## Not planned

- A flag in the hosted shell that turns a mitigation off or loosens it for every applet without the user. `SOUL.md` opinion three rules it out. `KernlOptions.guard.profile` lets an embedding host pick the starting limits only.
- A second event library beside applesauce. `DECISIONS.md` [D-002](./decisions.md#d-002) rules it out.
- A "recommended" messaging provider. [D-009](./decisions.md#d-009) rules it out.
