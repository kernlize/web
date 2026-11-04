# kernl handoff

Living document for the next session. Updated as background agents report. Last update: 2026-11-04.

## Goal (owner's /goal, abridged)

First draft of kernl (opinionated NIP-5D shell on kehto). Opinions: applesauce is the event layer; empower the user and contain applets; implement every kehto experimental mitigation; bridge as many protocols as possible; no messaging protocol ranked, all exposed to Direct Messenger interfaces. Requirements: world-class docs, BDD + full coverage, aislop 100/100, beautiful+useful README, gorgeous site with no protocol names, amiagentready 84+ (llms.txt, WebMCP), Astro at `/`, VitePress at `/docs`. Never mention the private prior-art repo.

Owner direction since (2026-11-04):
- Support **every Nostr-compatible private messaging protocol** — all messaging NIPs, Marmot (MLS), NDR (double ratchet) — as unranked providers.
- **Expose every provider to applets over NAP-DM** (the `dm` domain), not only the shell's Messages panel.
- Downloads should run in-shell where a browser can; hand-off stays as an option.

## Where things are

- Source: `kernlize/web` (private), branch `main`, pushed. Last shipped commit `103d75a` (kehto 0.30.0 lock).
- Site: https://kernlize.github.io/ (docs `/docs/`, shell `/app/`, preview `/app/?preview=1`), published from `kernlize/kernlize.github.io` by `pnpm site:publish` (manual, owner's choice).
- Gates (all passing at `103d75a`): `pnpm check` (build, type-check, 820 tests at 100% coverage, deps, astro check, docs:check incl. jsdoc + doc samples, pages build, vocabulary, agent-ready 22/22, slop 100), `pnpm exec playwright test` (41/41, also against production with `PLAYWRIGHT_BASE_URL=https://kernlize.github.io`). CI on GitHub green. Live amiagentready 90.
- Context docs: `SOUL.md`, `DECISIONS.md` (D-001…D-015; D-016+ being added by agents), `AGENTS.md`.
- kehto issues filed: kehto/web #397–#400 (API gaps). `@kehto/shell` 0.30.0 released (was stuck: CI run on the Version Packages commit was cancelled by a follow-up merge; release.yml dispatched manually).

## In flight (background agents, not yet shipped)

| Work | Scope | Status |
|---|---|---|
| NDR / ratchet messaging | `ratchet-backend.ts` + `ratchet-storage.ts` on `nostr-double-ratchet` 0.0.183; NAP-DM scenario; D-016 | **done, not shipped** (see report 1) |
| Marmot (MLS) + messaging NIP inventory | `group` provider on `@internet-privacy/marmot-ts` 0.9; NIP inventory; NAP-DM scenario; D-018 | **done, not shipped** (see report 3) |
| In-shell downloads | `webtorrent-backend.ts`, `createDefaultBridges({ torrent })`, `webtorrent` 3.0.21 lazy in host page, Downloads panel, Settings choice; D-017 | **done, not shipped** (see report 2) |

Agents do not run git. When each reports: run `pnpm check` and `pnpm exec playwright test`, commit (Conventional Commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`), `git push origin main`, `pnpm site:publish`, then confirm CI (`gh run list -R kernlize/web --workflow ci.yml`) and the live site (amiagentready scan with a cache-busting query; Playwright against production).

## Open items needing the owner

- Release PRs: enable "Allow GitHub Actions to create and approve pull requests" at the `kernlize` org (blocked; needs `admin:org` scope: `gh auth refresh -h github.com -s admin:org`).
- Report kehto's creation-only lock bypass routes (customized built-in `new`, XSLT, prefixed XHTML via importNode/adoptNode) — owner reporting privately; written up in D-014. kernl's insertion lock blocks them.
- Optional: file kehto's release race (cancel-in-progress CI vs Version Packages gate) as a kehto issue.

## Known limits (documented)

- Guard profile is shell-wide; per-applet planned (D-003).
- kehto #399 would let kernl hold (defer) a hidden window's requests instead of refusing them.
- A declined hand-off still reports success (openLink gives no signal).

## Agent reports

(appended as each background agent finishes)

### 1. NDR / ratchet messaging — finished 2026-11-04 (not yet shipped)

- `ratchet` provider is the live default when the account signer has `nip44`. Built directly on `nostr-double-ratchet` 0.0.183 `NdrRuntime` (not kehto's `createNdrDmAdapter`, which files typing notices as messages, never initialises/registers the runtime and does not follow the active account).
- The raw account key is **not** needed (`ownerIdentityKey` optional); the account signs only its device list. The library keeps its own device and session keys and writes them to storage in clear, so kernl wraps storage with `createSealedRatchetStorage` (`ratchet-storage.ts`): every value nip44-encrypted to the account, chunked, opaque slot ids, sealed key map. Library events with empty `pubkey` are re-signed from the template.
- Tests: `packages/core/features/ratchet-backend.feature` (7 scenarios, real crypto, fake relay network moved to `features/steps/relay-network.ts`); NAP-DM scenario in `kernl.feature` via `features/steps/kernl-dm.ts`. New files at 100%.
- Docs/copy updated; D-016 appended; `.changeset/ratchet-sessions.md`; dependency `nostr-double-ratchet@^0.0.183` in packages/core.
- Limits (in alpha-status + D-016): both parties need a shared relay (inbox relays not read); conversation list in memory (sessions/keys persist); first use can wait ~12 s for device-list discovery (`discoveryTimeouts` option); extension/remote signers prompted per stored value per page load.
- **Gate state when it finished:** everything passes except `pnpm test`/`pnpm check`, broken by the concurrent Marmot agent (`apps/web/features/preview-messaging.feature` expects `private,legacy,ratchet`, now also gets `group`; group files below 100%). Re-run gates after the Marmot agent reports. Playwright 43/43 after its fix.

### 2. In-shell downloads — finished 2026-11-04 (not yet shipped)

- `packages/bridges/src/webtorrent-backend.ts`: `createWebTorrentBackend({ client | loader, trackers?, now?, progressIntervalMs? })`; same hash = one job; progress throttled 500 ms; reasons `invalid:info-hash`, `unavailable:<why>`, `unavailable:not-finished`, `denied:unknown-download`. `BackendTraits.handoff` now `true | undefined`, read on every availability check so the bridge follows the user's choice.
- Core: `createDefaultBridges({ http, handoff, torrent? })` (torrent wins for magnet only); `KernlOptions.torrent` additive.
- Shell: `webtorrent` **3.0.21** pinned in apps/web, browser build lazy-loaded only on first download (own chunk). Settings choice "Download in kernl" (default when `RTCPeerConnection` exists) vs "Open in an app on your device" at `kernl:downloads:mode:v1`. Downloads button + panel (paste link, progress, pause/resume/remove, Save via blob URL). Preview uses a fake client. Host page CSP only `frame-src 'none'`, so WebRTC/wss work there; applet frames unchanged. Real library loaded on `/app/` in headless Chromium: no errors, wss trackers connected.
- Tests: `packages/bridges/features/webtorrent-backend.feature` (22), `apps/web/features/shell-downloads.feature`, core kernl/services scenarios (steps in `packages/core/features/steps/kernl-bridges.ts`), 4 new Playwright download specs, Downloads panel in the vocabulary walk. Own files 100%.
- Docs: D-017 (NZB/Soulseek/mail stay hand-off: browsers cannot open raw TCP for NNTP/Soulseek/SMTP/IMAP), bridges concept/package pages, core.md, alpha-status, changelog, roadmap (companion service), add-a-bridge-backend (seedbox example), public bridges page, README. `.changeset/in-kernl-downloads.md`.
- **Gate state when it finished:** its own work green; `pnpm check` red only from the in-flight Marmot work (preview-messaging scenario expects 3 providers, gets 4; TypeDoc warning about unexported `InboxRelays` in `packages/core/src/messaging/`). Re-run all gates after the Marmot agent reports.

### 3. Marmot (MLS) + messaging NIP inventory — finished 2026-11-04 (not yet shipped)

- New `group` provider "Group sessions" (experimental) on `@internet-privacy/marmot-ts@^0.9.0` (marmot-protocol org, applesauce 7, no nostr-tools). Backend: `packages/core/src/messaging/group-*.ts`. Account signer signs identity proofs/key packages and opens invites with nip44; MLS keys live in the library; every stored value nip44-sealed to the account. Using it publishes a key package (additive, no consent prompt; documented). New send refusal `unavailable:recipient-not-ready`.
- Inventory table in `docs/concepts/messaging.md#protocol-inventory`: NIP-04 `legacy` ✓, NIP-17 `private` ✓ (kind 15 files on roadmap), NDR `ratchet` ✓, Marmot `group` ✓ (supersedes NIP-EE), NIP-29 not a provider (relay reads content; doesn't fit `dm` recipient model; D-018), NIP-28/C7/A4/A0 public chat out of scope.
- NAP-DM: kernl.feature scenario drives dm.status/send (provider hint)/subscribe/conversations/messages over a real port with `group:<hex>` ids; concept page documents every provider is reachable over NAP-DM.
- Tests: `packages/core/features/group-sessions.feature` (12 scenarios, real MLS between test accounts). Vocabulary check now also denies "marmot"/"mls".
- Limits (alpha-status/roadmap): group message history in memory (keys deleted after read); one device per account per group; no naming/adding/removing/leaving yet; kind 10051 key-package relay lists not read.
- D-018 (multi-protocol messaging); `.changeset/group-sessions-provider.md`.
- **Gate state when it finished (all three agents' work combined):** `pnpm check` green — 887/887 tests, 100% coverage, slop 100; Playwright 43/43.

## Next step

All three agents are done. Ship: re-run `pnpm check` and `pnpm exec playwright test`, commit (one commit per agent's area or one combined), `git push origin main`, `pnpm site:publish`, confirm CI and the live site (amiagentready + Playwright with `PLAYWRIGHT_BASE_URL=https://kernlize.github.io`). Then mark this document "shipped" and commit it.
