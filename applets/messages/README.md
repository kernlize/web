# Messages

A direct-message applet for the kernl shell: a NIP-5D napplet that reads and
writes direct messages through NAP-DM. It shows the conversations; the shell
that runs it picks the protocol and does the encrypting, signing, routing and
storing. The applet never holds a key, opens a socket or names a provider.

## What it does

- Lists conversations, one thread per person. A shell reports one conversation
  per provider, so every `direct` conversation with the same participant set is
  merged into a single thread; each `group` conversation stays its own thread.
  Conversation ids are opaque and are never parsed or shown.
- Reads a thread's whole history (`dm.messages`, following the cursor) when the
  thread is opened, merges it by time, drops duplicates by message id, and
  groups it by day. Threads nobody has opened are read one at a time in the
  background, most recent first, so the list gains previews and unread counts
  without a burst of requests.
- Follows live delivery with one `dm.subscribe({})`. A message on a conversation
  it has not seen makes it ask for the conversation list again.
- Counts unread itself. The shell's `unread` number is a lifetime count, so it is
  ignored; unread means "from someone else and newer than the last time this
  thread was open". On the first run everything already there counts as seen.
- Sends without choosing a route: a direct send carries the recipient and no
  conversation id, so the shell decides how it travels. The shell may ask the
  person a question first, so a bubble stays "sending…" for as long as that
  takes and the composer stays usable. A refusal becomes "Not sent" in plain
  words with Retry; the raw reason is never displayed.
- Starts a thread from an account id (64 hex characters or the bech32 form).
- Keeps a draft per thread.
- Paces itself. A strict shell allows an applet about eight requests a second
  (a quarter of that for an unfocused window) and silently drops the rest, so
  every request goes through one pacer; see "Request budget" below.

Everything a person can read or have read to them uses the shell's vocabulary
(applet, account, account id, provider, shell). `tests/guidance.test.mjs` and
the frame check both fail on a protocol word in the interface.

## NAP boundary

| Capability | Domain | Declared | Used for | Without it |
| --- | --- | --- | --- | --- |
| Conversations, history, send, live delivery | `dm` | required | the one job | "Messages are not available here yet." with Retry |
| Who is signed in, account changes | `identity` | optional | reload on account switch; asked for the account only when `dm.status()` names no owner, to tell signed-out from not-available | owner taken from `dm.status().ownerPubkey`, which always wins |
| Host colours | `theme` | optional | whole-surface colours | local palette that follows the system light/dark preference |
| Notices | `notify` | optional | a short notice for a message that arrives while its thread is not in view | nothing |
| Drafts and last-seen times | `storage` | optional | survive a reload (one stored value per account: one read at startup) | kept in memory for the life of the frame |
| Shortcuts | `keys` | optional | `messages.new`, `messages.next`, `messages.previous` | buttons only |

No relay escape hatch, no `outbox`, no `resource` (avatars are initials on a
colour derived from the account id, so no bytes are requested), no config
schema.

The manifest also declares the archetype `dm` with the convention
`napplet:dm/open` (payload `{ pubkey: <64 hex> }`, treated as untrusted).

### Known gaps

These come from the package versions this directory is pinned to. They are
gaps, not features:

- **Opening a thread on another applet's request is not wired.** The installed
  `@napplet/sdk` (0.24.x) has no call for receiving an intent; `intent.onDelivery`
  ships from 0.29. `parseOpenRequest` (validated, unit-tested) and
  `MessagesApp.openDirect` are ready; `src/main.ts` marks where the registration
  goes. `intent` is therefore not listed as a used domain.
- **Optional domains are not in the manifest.** The installed
  `@napplet/vite-plugin` (0.11.x) has `requires` but no `optional`, so the deploy
  template carries `R dm` and no `O` tags. Its archetype option is
  `{ slug, naps }` rather than `{ slug, convention }`; the emitted `z` / `i`
  tags are the expected ones.
- **A send that waits longer than the binding's request timeout** is reported to
  the applet as unanswered. The applet keeps that bubble "sending…", settles it
  when the shell echoes the message on the live subscription, and offers Retry
  and Discard on it; it never sends again by itself.
- **Previews cost a full history read.** A conversation summary carries no last
  message and history pages run oldest first, so a thread's preview and unread
  count are only known once its history has been read. Until the background
  reader gets to a thread, its row shows the name and time only.

## Request budget

Every request to the shell leaves through `src/shell.ts`, which owns the one
pacer (`src/pacer.ts`). `tests/guidance.test.mjs` fails if another module
imports a callable SDK binding.

- **Rate.** At most four requests start in any rolling second: half the
  focused budget. It is a rolling-window limit rather than a literal token
  bucket, because a bucket of four refilled at four a second still lets seven
  through in one second.
- **Order.** First in, first out, in three lanes: a send goes ahead of
  everything waiting; background work (history for unopened threads, saving
  drafts) only moves when nothing else has been asked for a second, so it never
  exceeds one request a second.
- **Startup.** The first second holds four requests: `dm.status`, one
  `storage` read, `dm.conversations`, `dm.subscribe`. The current theme and the
  three shortcut registrations follow in the next second. No history is read
  until a thread is opened or the shell has been idle.
- **Drops.** Reads that are safe to repeat (status, conversations, messages,
  stored state, theme, the account, the live subscription) get four seconds per
  attempt and two more attempts with a growing pause; an error starting
  `firewall:` counts as a drop. An attempt that went quiet is not abandoned, so
  a slow shell's late answer still wins. A send is never repeated.
- **Easing off.** Any drop or refusal slows the pacer to one request a second
  for five seconds, which fits inside the unfocused budget and lets it recover.
- **Error records.** A binding may answer a refused `dm` request by resolving
  with `{ error: "<reason>" }` rather than rejecting. `src/shell.ts` turns that
  into a rejection with the same reason (`src/dm-result.ts`), so a declined send
  reads "Not sent." and a `firewall:` record on a read is asked again.
- **Not paced.** Listening (`dm.onMessage`, account and theme changes) sends
  nothing; the binding only records the handler.

Shortcut registration is made once and not repeated, since a second
registration would run each action twice. If the shell drops one, that action
stays button-only for the session.

## Layout

The shell frames the applet and shows its name, so there is no heading. Width
tiers are container queries on the frame (`src/tiers.css`):

| Frame | Shows |
| --- | --- |
| under 240px | avatar tiles with unread dots; a thread opens full-frame with a back button; one-line composer |
| 240–480px | one pane at a time: list, or thread with a back button |
| 480–900px | list (200–260px) beside the thread |
| over 900px | wider list with a preview line and time; the thread takes the rest, bubbles capped at a readable measure |
| under 220px tall | no search field; the thread header folds into a side rail so the composer and latest messages keep the height |

## Source

| File | Holds |
| --- | --- |
| `src/threads.ts` | pure: thread merging, message merging, unread, titles |
| `src/account-id.ts` | pure: hex / bech32 account ids, open-request validation |
| `src/send-errors.ts` | pure: refusal reasons to plain words |
| `src/view-model.ts`, `src/format.ts`, `src/saved-state.ts` | pure: rows for the list and the log, labels, stored state |
| `src/pacer.ts`, `src/retry.ts`, `src/dm-result.ts` | pure: the request pacer, repeating a dropped read, error records |
| `src/shell.ts` | the only module that calls the shell; owns the pacer |
| `src/app.ts`, `src/account.ts`, `src/outgoing.ts`, `src/history.ts` | state, whose messages these are, send requests, history paging |
| `src/view.ts`, `src/list-view.ts`, `src/log-view.ts`, `src/dom.ts` | DOM |
| `src/persist.ts`, `src/theme.ts` | stored state, colours |
| `src/main.ts` | boot order, account changes, shortcuts, teardown |

The page has no form elements: the frame is sandboxed without form submission,
so a submit event never fires there.

## Verify

```bash
pnpm verify             # guidance test + unit tests + type-check + single-file build
pnpm test:conformance   # build, then the reference shell in a real sandboxed iframe
pnpm test:frames        # needs a build; see below
```

`pnpm test:unit` runs the pure modules under `node:test` (`tests/unit/`).

`pnpm test:frames` loads the built `dist/index.html` into a
`sandbox="allow-scripts"` iframe at 200×160, 320×560, 900×600 and 2400×1200 in a
dark and a light theme, walks list → thread → send → reply → refusal, checks for
overflow, clipped controls and forbidden wording, and writes PNGs to
`tests/screenshots/`. The shell in that check is **a stub**
(`tests/harness/stub-shell.js`): a hand-written `window.napplet`, not kehto and
not kernl. It carries a request guard modelled on a strict shell's (eight a
second, the excess dropped without a reply), and every run fails if anything
was dropped or more than four requests started in one second; two further runs
starve the budget to a quarter and check that the list still arrives. It
verifies layout and applet-side behaviour only. It needs
Playwright's Chromium, which this package does not depend on; it resolves
`@playwright/test` from the workspace root.

Preview in a real runtime with Paja:

```bash
napplet paja -- --target-url http://127.0.0.1:5173 -- pnpm vite --host 127.0.0.1 --port 5173 --strictPort
```

Paja has no seeded direct-message runtime. Its `dm` service only exists with
its dev signer on live relays, so by default the applet shows its signed-out or
not-available state there. A raw Vite URL is an asset server, not a preview.

`dist/index.html` is the whole artifact: scripts and styles inline, nothing
fetched. The build also writes `shipped/applet.json` (what `applet.json`
declares plus the artifact's SHA-256) for the shell that ships it; keep
`applet.json` in step with `requires` and `archetypes` in `vite.config.ts`.

## Agent skills

For agent-driven work on this applet, install the `napplet-*` skills and follow
`napplet-make`:

```bash
npx skills add napplet/napplet
```

`AGENTS.md` and `docs/` carry the boundaries the skills assume. The living
NIP-5D and NAP documents remain protocol truth; nothing here is normative.
