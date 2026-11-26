# The store and intents

kernl finds applets for the user and lets applets hand work to each other. The store lists what publishers have released; intents let one applet ask for a role and an action, "open a profile", without naming the applet that does it. The user picks who does it, once or every time. This page explains both from the shell's side; [D-026](../decisions.md#d-026) records the decisions.

## The store

The launcher opens on the store. `kernl.catalog.stream()` (`streamCatalog`, `packages/core/src/catalog/fetch.ts`) asks the `apps` and `super` [relay tiers](./relay-tiers.md) for root and named applet manifests, and for the deletion requests (kind 5, NIP-09) their publishers signed, and emits the list again each time a relay sends more. The first relay to answer fills the store while slower ones are still talking; a relay that fails keeps nothing else from showing; a manifest its own publisher deleted is not listed. The stream completes when every relay has finished, or at `CATALOG_TIMEOUT_MS` (30 s), which is an outer bound and not a wait. `kernl.catalog.load()` resolves with the final list.

Each manifest becomes a `CatalogEntry` (`toCatalogEntry`) only when its signature verifies, so a relay cannot list an applet under someone else's name. Its bytes are not fetched; they are verified when the user opens it, exactly as for a pasted address. Repeated versions collapse to the newest per catalogue id (`newestEntries`).

| Entry field | From the manifest |
| --- | --- |
| `title`, `description` | the title tag and content; an untitled applet is named by its identifier |
| `topics` | `t` tags, lower-cased and deduplicated |
| `requires` | `R` tags (or legacy `requires`) |
| `archetypes`, `conventions` | `z` tags and `i` tags: the roles and requests the applet takes |
| `iconUrl` | the icon's hash on the manifest's first server, for display only |
| `address` | a shareable `naddr1…`, or `nevent1…` for a pinned version |

`searchCatalog(entries, query)` filters and ranks. Every search word has to match some field; a whole word beats a prefix, a prefix beats a substring, and a typo is forgiven only within one word ("mnswpr" finds Minesweeper, but a long description does not match everything). Titles weigh most, then topics and roles, then descriptions and publishers. `popularTopics` counts topics for the bubbles above the results; a selected topic stays in front even when it is not popular.

The store shows only applets whose required domains this shell offers, and says how many it hides; one switch shows them too. Typing or pasting an address into the search offers **Look up** for it, so an address always works, and `/app/?open=<address>` opens one from a link.

The [preview](../tutorials/run-the-shell.md) never reaches the network. Its store lists the three sample applets the build signed, read from relays that live in the page.

## Stacks

People group applets into **stacks**: NIP-51 app curation sets, kind `30267`, one event per `(publisher, d)`. They are how AppStore's "Add to stack" and Recommend hearts are stored, and any client can read them. The launcher's **Stacks** tab lists them and opens the members the person chooses ([D-071](../decisions.md#d-071)).

`kernl.stacks.stream()` (`streamStacks`, `packages/modules/src/stacks/fetch.ts`) asks the same `apps` and `super` tiers for kind `30267` and emits the list as relays answer; `kernl.stacks.load()` resolves with the final one. A signed set becomes an `AppletStack`: an `id` of `<publisher>:<d>`, the `title` (then `name`, then the `d`), its `description`, and its `members`. A member is one `a` tag read as a manifest coordinate — `35129:<pubkey>:<d>` for a named applet, `15129:<pubkey>:` for a root one — with the same catalogue id the intents catalogue uses and any relay hint the tag carried. An `a` tag that names anything else, such as a zapstore app, is not a member.

Sets are addressable, so `newestStacks` keeps the newest version of each and drops one that no longer holds an applet: republishing a set empty is how AppStore deletes it, because napplet shells refuse NIP-09 deletions.

Every applet in a stack is **installed** — recorded so another applet can hand it work — and only the ticked ones are opened ([D-073](../decisions.md#d-073)). The publisher's `start` tags decide which are ticked; a stack without them ticks all of its members, and each applet in the list can also be opened on its own through the ordinary review. An applet that is installed and not open is dormant, and wakes the first time another applet asks it for something, with only its existing grants ([D-074](../decisions.md#d-074)).

Opening a stack looks up every applet in it as if its address had been pasted — verified the same way, one at a time, so one that is gone or unreachable is skipped and counted — and then asks once for the permissions of the applets being opened ([D-072](../decisions.md#d-072)). The combined table groups ordinary grants by domain and asks separately about exceptions to the message seal, each row naming every applet in the stack that asked for it and marking the ones that cannot start without it; switching a row changes only those applets whose switches are available. A mixed row left alone preserves each applet’s previous answer. Only after that answer is anything planned, and each applet is admitted by the firewall in turn before the next is planned. Nothing in a stack is a grant by itself. A running window is brought forward only if it has the same verified artifact and already offers the reviewed domains. Otherwise the shell starts a replacement, keeping any grants or withdrawals made for now through the switch.

## Installing

Running an applet installs it: `kernl.plan` records the verified applet in `kernl:installed:v1`. `kernl.install(summary)` installs one without opening it and refuses a summary the shell did not verify with `invalid:unresolved`. The installed set (`kernl.intents.installed()`) is what intents resolve against, so the requests an applet takes always come from a manifest the shell verified. **Applets → Yours** lists it; removing an applet there stops other applets handing it work. Grants are separate and stay with the applet's exact build ([Identity and grants](./identity-and-grants.md)).

## Intents

An applet with the `intent` grant asks with a convention such as `napplet:profile/open?pubkey=…`. kehto's `createIntentService` validates the request and asks kernl's router (`createIntentRouter`, `packages/core/src/intents/router.ts`), which wraps kehto's `createCatalogIntentResolver`. The sender is always the verified catalogue id of the window the request came from, never anything the applet sent.

The handler is chosen in this order:

1. A handler the request names explicitly is used only when the user picked it for this request. An applet cannot address another applet on its own.
2. The user's default for the role, kept on this device.
3. A handler the request recommends, when it is installed.
4. When exactly one compatible handler is installed, or exactly one of the user's published preferred handlers is, that one.
5. Otherwise the user chooses. The chooser says what was asked ("Notes wants to open a profile."), lists the installed applets that can do it with the user's preferred ones first, and offers **Always use it to open a profile**.

When nothing installed can take the request, the chooser opens on the store, narrowed to applets that accept the convention, with any recommendation offered first. The user reviews the applet's grants as for any first run and picks **Use this applet**; the shell installs it and the request goes to it. If the user cancels, the asking applet is told `no handler` (or `user cancelled` when it had handlers to choose from).

Once the request is accepted, the asking applet is told yes and the shell owns delivery. It reuses a window only if it started with `intent` and its verified manifest declares the requested convention. It brings a reused or newly opened handler forward unless the request specifies `focus: false`. In that case a reused window stays where it is, and a new window opens behind the existing windows without taking focus, in any layout. A new handler opens under its existing grants, and the shell checks that the opened release still declares the convention. Delivery waits for kehto's recipient check to confirm that the target session is live and can receive `intent.deliver`. A fresh hidden window cannot finish its handshake until shown, so the user may need to show it and retry. If delivery expires, the user sees a notice such as "Profiles could not take the request" and why.

## Receiving is a grant

A handler receives requests only while it holds the `intent` grant, shown as "opening other applets". The store's review offers that switch to every applet that takes requests, switched on at its first run, and to an applet that requires it to ask others. Turning it off in the window's grants stops deliveries to that applet. Turning it on does not change a window that started without it: open the handler with the grant and try again.

## The user's preferred handlers

Preferences are the user's, never an applet's.

- **On this device.** **Applets → Yours** lists every role an installed applet takes ("Profiles", "Text editors") with **Ask each time** or one applet. The chooser's **Always use it** sets the same thing. They are kept in `kernl:intent-defaults:v1`.
- **With the account.** When an account signs in, the shell reads its published handler preferences (kind 31129) from its `outbox` and `super` relays, checks each event's signature and author, and keeps the newest per role. They pre-select or rank handlers; a local default still wins. With **Keep these choices with your account** on (`kernl:intent-sync:v1`, off by default, because the role a choice is for is public), each new default is published, keeping every other entry, including private ones the shell does not read.
- **From an applet.** An applet that manages handler preferences publishes the same events. The shell treats that as a change to the user's record: the consent dialog names the role and the applets added and removed, and nothing is written without the user's answer.

## Limits

- Private (encrypted) preference entries are carried over, not read. kehto's default-handler hook takes only the role, so a preference for one request ("edit a profile") ranks the chooser rather than selecting silently.
- The store lists titles, descriptions and icons as publishers wrote them.
