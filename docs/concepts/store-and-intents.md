# The store and intents

kernl finds applets for the user and lets applets hand work to each other. The store lists what publishers have released; intents let one applet ask for a role and an action, "open a profile", without naming the applet that does it. The user picks who does it, once or every time. This page explains both from the shell's side; [D-025](../decisions.md#d-025) records the decisions.

## The store

The launcher opens on the store. `kernl.catalog.load()` (`loadCatalog`, `packages/core/src/catalog/fetch.ts`) asks the `apps` and `super` [relay tiers](./relay-tiers.md) for root and named applet manifests and waits at most `CATALOG_TIMEOUT_MS` (8 s) before listing what arrived, so a slow or dead relay never keeps the rest from showing.

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

The [preview](../tutorials/run-the-shell.md) has no network. Its store lists its own three applets, shaped as store entries.

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

Once the request is accepted, the asking applet is told yes and the shell owns delivery. A running handler is reused and brought forward unless the request asked otherwise; otherwise the shell opens it under the grants it already has. `createIntentDelivery` retries until the handler's session is up and holds the receiving grant, then sends `intent.deliver`. If that never happens, the user sees a notice such as "Profiles could not take the request" and why.

## Receiving is a grant

A handler receives requests only while it holds the `intent` grant, shown as "opening other applets". The store's review offers that switch to every applet that takes requests, switched on at its first run, and to an applet that requires it to ask others. Turning it off in the window's grants stops deliveries to that applet.

## The user's preferred handlers

Preferences are the user's, never an applet's.

- **On this device.** **Applets → Yours** lists every role an installed applet takes ("Profiles", "Text editors") with **Ask each time** or one applet. The chooser's **Always use it** sets the same thing. They are kept in `kernl:intent-defaults:v1`.
- **With the account.** When an account signs in, the shell reads its published handler preferences (kind 31129) from its `outbox` and `super` relays, checks each event's signature and author, and keeps the newest per role. They pre-select or rank handlers; a local default still wins. With **Keep these choices with your account** on (`kernl:intent-sync:v1`, off by default, because the role a choice is for is public), each new default is published, keeping every other entry, including private ones the shell does not read.
- **From an applet.** An applet that manages handler preferences publishes the same events. The shell treats that as a change to the user's record: the consent dialog names the role and the applets added and removed, and nothing is written without the user's answer.

## Limits

- kehto's ACL gives `intent.deliver` no recipient capability, so kehto's recipient-checked send refuses it. kernl delivers over the target's bound port behind its own `intent:read` check, as kehto's reference host does, until kehto maps the delivery ([D-025](../decisions.md#d-025)).
- Private (encrypted) preference entries are carried over, not read. kehto's default-handler hook takes only the role, so a preference for one request ("edit a profile") ranks the chooser rather than selecting silently.
- The store lists titles, descriptions and icons as publishers wrote them.
