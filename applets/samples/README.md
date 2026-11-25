# Samples

Three small NIP-5D napplets, **Notes**, **Pulse** and **Profiles**, built from
one page. Each button makes one real `@napplet/sdk` call, so a shell can show
its consent dialogs, its guard and its firewall against real applet traffic.
They replace the hand-written preview applet in `apps/web` once the shell loads
them (previewPreset, step 3); nothing loads them yet.

The specs (title, description, `requires`, `optional`, topics, accepted
conventions, extra buttons) live in `src/specs.ts`, ported from `SPECS` in
`apps/web/src/shell/preview-applet.ts`.

| Sample | `d` | Requires | Optional | Accepts | Extra buttons |
| --- | --- | --- | --- | --- | --- |
| Notes | `notes` | outbox, identity, intent | notify, storage, config, link, torrent | | |
| Pulse | `pulse` | outbox | notify, media, resource, link, torrent | | contacts, inbox and outbox, erase request |
| Profiles | `profiles` | | notify, intent | `napplet:profile/open` (archetype `profile`) | |

Two changes from the specs they were ported from, decided by the owner on
#131: everything that publishes or reads goes through OUTBOX rather than the
`relay` escape hatch, and the domains the buttons need are declared optional
(`link` and `torrent` on Notes and Pulse, `intent` on Profiles).

## Buttons

| Button | SDK call | Result line |
| --- | --- | --- |
| Publish a note | `outbox.publish` kind 1 | `Note: done.` / `you said no.` |
| Update your profile | `outbox.publish` kind 0 | `Profile: …` |
| Delete a note | `outbox.publish` kind 5 | `Deletion: …` |
| Send a notification | `notify.send` | `Notification shown.` |
| Open its settings (Notes) | `config.registerSchema` once, `config.subscribe`, `config.openSettings` | `Its settings: …`, secret only said to be set |
| Open a profile | `intent.open('napplet:profile/open', { payload: { pubkey } })`, then `intent.available('profile')` for the taker's title | `Profiles is taking it.` / `Nobody took it (…).` |
| Flood the shell | 40 × `outbox.subscribe` at once | how many answered (an event or a close) after 3 s |
| Download a shared file | `torrent.add` with a magnet | `Added to your downloads.` |
| Open a link | `link.open('https://kernl.run/docs/')` | `The link was opened.` / `You did not open the link.` |
| Replace your contacts (Pulse) | `outbox.publish` kind 3 | `Contacts: …` |
| Change your inbox and outbox (Pulse) | `outbox.publish` kind 10002 | `Inbox and outbox: …` |
| Ask to erase your identity (Pulse) | `outbox.publish` kind 62 | `Erase request: …` |

Profiles listens with `intent.onDelivery` when the shell injected `intent`, and
writes a line for each request handed to it.

A button whose domain the shell did not inject is marked "(not granted)" and
answers locally with "Refused: this applet has no grant for …". Settings are
hidden on samples that do not declare `config`. An `outbox.publish` refusal
comes back as `ok: false` with a reason; the binding's own request timeout
rejects, so a question the person leaves open past it reads "not sent".

## Pulse floods on purpose

The template's rule is that every request goes through a pacer and nothing is
sent in a burst (`applets/messages/AGENTS.md`). **Pulse breaks it
deliberately**: "Flood the shell" sends 40 OUTBOX subscriptions at once so the guard
has something to hold back. The other buttons send one request per click, so
this package has no pacer. Do not copy the flood into a real applet.

## Build and signing

```bash
pnpm build    # vite build --mode notes|pulse|profiles, then scripts/ship.mjs
pnpm verify   # guidance test, build, unit tests, type-check
```

Each build mode writes a single-file `dist/<name>/index.html` and the
plugin's `.nip5a-manifest.json` template (kind 35129, `d`, `x`, `R`, `O`,
`z`, `i`). `scripts/ship.mjs` then:

1. generates a fresh secp256k1 key in memory;
2. checks each `x` tag against the built bytes;
3. adds `pubkey` and `created_at`, computes the NIP-01 id, and signs it (BIP-340);
4. writes `shipped/samples.json`, `{ publisher, samples: [{ name, title, manifest, file }] }`,
   and `shipped/<name>.html`, the exact bytes each `x` tag hashes.

The key is never written or logged, so every build has its own publisher and
nobody can sign another manifest under it. The package exports
`./samples.json` and `./<name>.html`.

## Agent skills

For agent-driven napplet work, install the `napplet-*` skills and follow
`napplet-make` (`npx skills add napplet/napplet`). The hard boundaries in
`applets/messages/AGENTS.md` apply here too, except the pacer rule above.
