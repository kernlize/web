# Error reasons

Every failure in the four packages carries a stable reason string with a prefix that says what kind of failure it is. Code matches on the string; the UI maps it to words. This page lists each reason the packages throw or report, collected from `packages/*/src`.

| Prefix | Means |
| --- | --- |
| `denied:` | A policy or the user said no. Retrying the same request will not help. |
| `invalid:` | The input is malformed or names something that does not exist. |
| `unavailable:` | Something needed is missing or unreachable right now: a backend, a server, a provider. |

Thrown reasons are the `message` of an `Error`. A few carry a detail after a space (`denied:scheme http:`), so match on the part before the first space.

## Thrown errors

| Reason | Package | Thrown by | Meaning |
| --- | --- | --- | --- |
| `invalid:pointer` | `@kernlize/core` | `decodePointer`, `resolveBuiltin` | The input is not, and does not contain, an `naddr`, `nevent`, `note`, 64-hex event id, coordinate or `kernl:<id>`; or it names a built-in applet the host does not ship. |
| `unavailable:manifest` | `@kernlize/core` | `fetchManifestEvent`, so `Kernl.resolve` | A relay answered, in the hints, the `apps` tier or the `super` tier, and none returned the manifest event; or there was no usable relay to ask. |
| `unavailable:unreachable` | `@kernlize/core` | `fetchManifestEvent`, so `Kernl.resolve` | No relay in any round opened a connection, after its one redial. Usually the person's side: offline, a blocking network, or a browser out of connections ([D-039](../decisions.md#d-039)). The applet may well exist. |
| `unavailable:network` | `@kernlize/core` | `fetchManifestEvent`, so `Kernl.resolve` | No relay answered in either round, though at least one opened a connection. The applet may well exist. |
| `unavailable:blob` | `@kernlize/core` | `defaultFetchBlob`, `resolveApplet` | No server returned the artifact bytes. kehto's `blob-unavailable` maps here. |
| `invalid:invalid-signature`, `invalid:invalid-manifest`, `invalid:aggregate-mismatch`, `invalid:blob-hash-mismatch`, `invalid:missing-index` | `@kernlize/core` | `resolveApplet` | Verification failed. The part after `invalid:` is kehto's `NappletResolutionErrorCode`. Nothing runs. |
| `invalid:artifact-hash` | `@kernlize/core` | `resolveBuiltin`, so `Kernl.resolve` of a `kernl:<id>` address | The bytes an applet shipped with the host loaded are not the bytes the host pinned. |
| `invalid:unresolved` | `@kernlize/core` | `Kernl.plan`, `Kernl.install` | The summary was not produced by this shell's `resolve`, so no verified bytes are held for it and it cannot be run or installed. |
| `unavailable:handler`, `unavailable:window`, `unavailable:delivery` | `@kernlize/core` | `createIntentDelivery`, after a request was accepted | The handler is no longer installed, the host did not open it, or it never held the receiving grant while delivery was retried. The asking applet was already told yes, so the user is told instead ([The store and intents](../concepts/store-and-intents.md)). |
| `denied:blocked` | `@kernlize/core` | `Kernl.plan` | The user blocked this applet identity. |
| `denied:nested-frame` | `@kernlize/core`, `@kernlize/guard` | `planMount`, so `Kernl.plan`; in the applet's realm, the insertion lock | kehto's `assertNappletHasNoFrame` found an `iframe`, `frame`, `frameset`, `object`, `embed`, `portal` or `fencedframe` element in the verified markup, so the applet is not mounted. Inside a running applet kernl's insertion lock throws it as a `TypeError` when applet code tries to connect a node that is or contains a frame element. A frame created by element factory or HTML string is refused earlier by kehto's nested-context lock, as `TypeError('kehto: napplets may not create nested browsing contexts')` ([D-014](../decisions.md#d-014)). |
| `unavailable:frame-lock` | `@kernlize/core` | `planMount`, so `Kernl.plan` | The srcdoc kehto prepared does not contain the CSP meta and namespace prelude where kernl expects them, so the insertion lock cannot be placed after kehto's lock and the applet is not mounted. Seen only with a kehto release whose output changed. |
| `denied:firewall` | `@kernlize/core` | `createAppletAdmissions`, so `Kernl.plan` | The firewall refused a domain the applet requires, by a `deny` rule or by the user's answer, or the user dismissed the question. Nothing runs ([Guard](../concepts/guard.md#the-firewall), [D-056](../decisions.md#d-056)). |
| `unavailable:firewall` | `@kernlize/core` | `createAppletAdmissions`, so `Kernl.plan` | The firewall could not decide. The usual cause is stored answers that could not be read (`kernl:firewall-decisions:v1`): every start is refused until the user clears them, and the shell says so. |
| `denied:admission-expired` | `@kernlize/core` | `Kernl.mount` | The firewall's admission for this plan no longer stands: an answer it relied on was taken back, or the plan was the oldest of more than `MAX_UNMOUNTED_PLANS` (16) left unmounted. Plan again. |
| `invalid:rule` | `@kernlize/core` | `createFirewallRules`'s `set`, so `Kernl.firewall.setRule` | The rule's target is one kehto refuses, for example a domain that is not a domain name. The rules are unchanged. |
| `invalid:frame-detached` | `@kernlize/core` | `mountApplet`, so `Kernl.mount` | The frame has no `contentWindow`; it is not in the document. |
| `invalid:domain` | `@kernlize/core` | `Grants.allowDomain` | The shell does not offer this domain in its current configuration. |
| `denied:baseline-domain` | `@kernlize/core` | `Grants.revokeDomain` | Baseline domains (`shell`, `inc`, `theme`, `storage`, `keys`) cannot be revoked. |
| `denied:plaintext-key-persistence` | `@kernlize/core` | `KernlAccountManager.addAccount` | The account type stores a raw secret key (`PLAINTEXT_KEY_ACCOUNT_TYPES`). |
| `invalid:relay-url` | `@kernlize/core` | `RelayTiers.add`; `mailboxTags`, so `AccountMailboxes.save` | The URL is not `ws://` or `wss://`. A save refused this way signs and publishes nothing. |
| `denied:read-only` | `@kernlize/core` | the outbox service's signer; `AccountMailboxes.save` | The session cannot sign, so an outbox publish or a new inbox and outbox list is refused. |
| `denied:consent` | `@kernlize/core` | `createSigningConsent`, through the window signer (`relay.publish`) or the outbox gate (`outbox.publish`) | An applet window asked to sign a destructive kind (any replaceable or addressable kind, 5 or 62) and the user denied or dismissed `host.presentConsent`. Nothing was signed or published. |
| `denied:unknown-applet` | `@kernlize/core` | `createSigningConsent` | A destructive write from a window the shell did not mount. |
| `denied:signed-out` | `@kernlize/core` | `createSigningConsent` | A destructive write (in practice an `outbox.publish`) while nobody is signed in. |
| `invalid:event-kind` | `@kernlize/core` | `createSigningConsent` | The event's `kind` is not a number. |
| `unavailable:sign-in-required` | `@kernlize/core` | `createDefaultMessaging`'s `createBackend`; `MessagingRegistry.enable` | `private` or `legacy` while no account is active (`MESSAGING_UNAVAILABLE_REASONS`). |
| `unavailable:signer-cannot-encrypt` | `@kernlize/core` | `createDefaultMessaging`'s `createBackend`; `MessagingRegistry.enable` | The active account's signer has no `nip44` (`private`) or no `nip04` (`legacy`); a read-only account is the usual case. |
| `unavailable:no-runtime` | `@kernlize/core` | `createDefaultMessaging`'s `createBackend`; `MessagingRegistry.enable` | `ratchet` registered by a host without a backend; `createKernl` always supplies one. |
| `invalid:duplicate-provider` | `@kernlize/messaging` | `MessagingRegistry.register` | A provider with this id is already registered. |
| `invalid:unknown-provider` | `@kernlize/messaging` | `MessagingRegistry.enable`, `disable`; the composite backend | No provider has this id, or a namespaced id, cursor or `provider` hint names no enabled provider. |
| `unavailable:<reason>` | `@kernlize/messaging` | `MessagingRegistry.enable` | The provider's `availability()` is false; `<reason>` is the bare word it reported. |
| `invalid:provider-not-enabled` | `@kernlize/messaging` | `MessagingRegistry.setDefault` | Only an enabled provider can be moved to the top as the default. |
| `denied:cancelled` | `@kernlize/messaging` | composite `send` | The user dismissed the question about which provider a reply should use; nothing was sent. |
| `unavailable:no-default-provider` | `@kernlize/messaging` | composite `send` | The request names no conversation and no provider, and there is no enabled default. |
| `invalid:no-recipients`, `invalid:unknown-conversation`, `unavailable:offline` | `@kernlize/messaging` | `createMemoryBackend` `send` | No recipient besides the owner; a `conversationId` the backend does not hold; the backend was created with `available: false`. |
| `invalid:recipient`, `invalid:groups-unsupported`, `unavailable:offline` | `@kernlize/core` | `createPrivateMessagesBackend`, `createLegacyMessagesBackend` `send` | The recipient is not a public key; the legacy backend got more than one correspondent; no relay accepted the message. |
| `invalid:locator` | `@kernlize/bridges` | `parseLocator` | Not a locator, or a malformed web, NZB, Soulseek or mail locator. |
| `invalid:magnet-missing-hash` | `@kernlize/bridges` | `parseLocator` | A magnet without a `urn:btih:` hash. |
| `invalid:locator-missing-<field>` | `@kernlize/bridges` | the torrent, NZB, Soulseek and mail bridges | The locator lacks `infoHash`, `url`, `user`, `path` or `address`. |
| `invalid:nzb-not-https` | `@kernlize/bridges` | the NZB backend from `createHandoffBackends` | The NZB document is not served over `https`, so it is not handed off and nothing is opened. |
| `invalid:duplicate-bridge <id>`, `invalid:scheme-taken <scheme>` | `@kernlize/bridges` | `BridgeRegistry.register` | A bridge with this id, or one serving this scheme, is already registered. |
| `unavailable:no-bridge` | `@kernlize/bridges` | `BridgeRegistry.resolve` | No bridge serves the scheme. |
| `unavailable:no-backend` | `@kernlize/bridges` | the four backend-driven bridges | The bridge was created without a backend. `availability().reason` is the bare `no-backend`. In the composed shell the four have hand-off backends; a registry built from `createDefaultBridges()` without a `handoff` opener reports this. |
| `denied:bridge` | `@kernlize/bridges` | `BridgeRegistry.resolve` | The registry's `authorize` hook returned false. The composed shell has none. |
| `denied:scheme <protocol>` | `@kernlize/bridges` | HTTP bridge | The URL's scheme is not in `allowedSchemes`. |
| `denied:private-address <host>`, `denied:private-address <host> -> <ip>` | `@kernlize/bridges` | HTTP bridge | The host is a blocked name or a private literal; the second form comes from a `resolveHost` result. |
| `denied:too-many-redirects` | `@kernlize/bridges` | HTTP bridge | More than `maxRedirects` hops. |
| `denied:redirect-unverifiable` | `@kernlize/bridges` | HTTP bridge | In a browser, `fetch` with `redirect: 'manual'` returns an opaque redirect whose target the bridge cannot read, so it cannot re-check the next hop and refuses. In Node and on servers redirects are followed and checked. |
| `invalid:redirect` | `@kernlize/bridges` | HTTP bridge | A redirect without a usable `Location`. |
| `denied:too-large` | `@kernlize/bridges` | HTTP bridge | `content-length` or the streamed body exceeds `maxBytes`. |
| `unavailable:timeout`, `unavailable:aborted`, `unavailable:network <message>` | `@kernlize/bridges` | HTTP bridge | The time limit expired, the caller cancelled, or `fetch` failed for another reason. In a browser a CORS refusal and a network failure are the same `TypeError`, so both surface as `unavailable:network Failed to fetch`. |
| `unavailable:network <type> response` | `@kernlize/bridges` | HTTP bridge | Any status-0 answer other than an opaque redirect, for example `unavailable:network opaque response`. |

`@kernlize/guard` throws nothing outside the applet realm. Its decisions are events.

## Download programs

The reasons behind the `torrent`, `nzb` and `soulseek` domains ([Connected programs](../concepts/download-programs.md)). There are three layers: an adapter rejects with a `ClientFailure` reason, the settings reject with their own, and each service turns whatever went wrong into the error code its NAP draft names before an applet sees it. An applet never receives an adapter's reason or its detail.

### Adapter reasons

Every method of `createTransmissionClient`, `createUtorrentClient`, `createNzbgetClient`, `createSabnzbdClient` and `createSlskdClient` rejects with an `Error` whose message starts with one of these (`ClientFailure`), all from `@kernlize/bridges`. Some carry a detail for a developer after a colon and a space (`unavailable:bad-response: HTTP 502`), so match with `startsWith`, not on the first word.

| Reason | Thrown by | Meaning |
| --- | --- | --- |
| `unavailable:unreachable` | every adapter | The request never got an answer: the connection was refused, the name did not resolve, or the browser blocked the request or withheld the answer (mixed content, or a program that does not allow the page's origin). |
| `unavailable:timeout` | every adapter | No answer within `ClientOptions.timeoutMs`, 15 000 ms by default. |
| `denied:credentials` | every adapter, on HTTP 401 or 403; `createSabnzbdClient` when the answer says the API key is missing or wrong; `createSlskdClient` when its sign-in answers 400 | The program answered and refused the name, password or key. |
| `unavailable:bad-response` | every adapter | The program answered with something the adapter cannot read: an unexpected status, a body that is not JSON or broke off, or a shape the program does not send. Usually another service is at that address, or a path is missing. |
| `unavailable:rejected` | every adapter | The program conclusively declined and changed nothing: Transmission's `result` was not `success`, uTorrent answered with an `error`, NZBGet did not take the document or could not start the job again, SABnzbd answered `status: false`, slskd answered 400, 409 or 429 or is not signed in to its network. |
| `unavailable:not-found` | every adapter | The program does not know the torrent, job, search or transfer named. |
| `unavailable:unsupported` | `createNzbgetClient`, `createSabnzbdClient` | This program, or this version of it, cannot do what was asked: an NZBGet that does not take a method that way, an archive password NZBGet cannot carry (a quote, a backslash or a control character), a SABnzbd job added both held and with its own priority, or `cancel` on SABnzbd. |
| `unavailable:outcome-unknown` | every adapter, for a request that changes something | The change was sent and may have applied, but could not be confirmed: the request timed out after it was sent, the job could not be read back afterwards, the program did not say which job it made, or a torrent sent to uTorrent did not appear in its list. Look before sending it again. |
| `unavailable:peer-unavailable` | `createSlskdClient` `browse` | The daemon could not reach the peer: slskd answered 404 (the peer is offline) or a 5xx (the peer connection failed). |
| `denied:peer` | no shipped adapter | In the `SoulseekClient` contract for a peer that refuses to share its list. `createSlskdClient` does not throw it; the `soulseek` service maps it to `peer_denied` for an adapter that does. |
| `invalid:info-hash`, `invalid:limit`, `invalid:priority`, `invalid:file-index` | `createTransmissionClient`, `createUtorrentClient` | The caller's input was wrong and nothing was sent: a hash that is not 40 lowercase hex characters, a limit that is negative or not a number, a priority other than -1, 0 or 1, or a file index the torrent does not have. |
| `invalid:state` | `createNzbgetClient`, `createSabnzbdClient` `control` | The job cannot take that action in its present phase. Nothing was sent. |
| `invalid:text`, `invalid:username`, `invalid:id`, `invalid:timeout`, `invalid:limit`, `invalid:path`, `invalid:size` | `createSlskdClient` | Search words that are empty or malformed, a peer name or id that is empty, `.` or `..`, a time limit or result limit that is not a positive number, or a file whose path or size cannot be sent. Nothing was sent. |
| `invalid:metainfo`, `invalid:metainfo-format` | `readTorrentMetainfo` | The `.torrent` file is malformed or unsafe (not canonical bencode, a missing v1 field, a path that leaves the torrent, over the size limit); or it is a v2 torrent with no v1 piece hashes. |
| `invalid:magnet` | `magnetInfoHash` | Not a magnet link, or one that names no v1 info hash. |

### Address and settings reasons

| Reason | Package | Thrown by | Meaning |
| --- | --- | --- | --- |
| `invalid:address` | `@kernlize/bridges` | `checkClientEndpoint`, as `EndpointCheck.reason`; thrown by `detectClientEndpoint`, so by `DownloadClients.check`, and by `DownloadClients.add` and `update` | Not a URL, or one with a query or a fragment. |
| `invalid:scheme` | `@kernlize/bridges` | the same | The scheme is not `http` or `https`. `add` and `update` take a complete address, so one without a scheme is refused this way; `check` works the scheme out first. |
| `invalid:credentials-in-address` | `@kernlize/bridges` | the same | The address carries a name or password (`http://name:pass@host`). They have their own fields. |
| `invalid:mixed-content` | `@kernlize/bridges` | the same | kernl's page was loaded over `https` and the address is plain `http` on another machine. A browser would block every request, so the address is refused before it is saved or tried. |
| `invalid:sign-in` | `@kernlize/core` | `DownloadClients.check`, `add`, `update` | A name, password or key is not text, or is longer than 512 characters. |
| `invalid:label` | `@kernlize/core` | `DownloadClients.add`, `update` | The connection's name, trimmed, is not 1 to 60 characters. Settings show "Give it a name, up to 60 characters." |
| `invalid:connection` | `@kernlize/core` | `DownloadClients.check` (with `existing`), `update`, `chooseDefault` | No connection has that id, `check`'s `existing` is a connection to another program, or `chooseDefault` names a connection that does not serve that domain. Settings show "That connection is no longer set up." |
| `unavailable:secrets` | a `SecretsProvider` | `get`, `set` or `delete`, so `DownloadClients.add`, `update` and `remove` | The keeper cannot be reached. Nothing is saved. When it happens while the shell reads the kept sign-ins at start, the connection's id is listed in `state().locked` instead. The built-in providers never reject. |
| `denied:secrets` | a `SecretsProvider` | the same | The keeper, or the person, said no. Handled exactly as `unavailable:secrets`: "not available now", never "there is no secret". |

`DownloadClients.check` also rejects with any adapter reason from the table above, from the program's `probe()`.

### What an applet is answered

Each service answers a failed request with the code its draft defines, and a reason or message in plain words that names no address, path, sign-in or id of the program's. Requests of an unknown type, or without a text `id`, get no answer.

**`torrent`** (NAP-TORRENT). The code is `error`: at the top level of the answer for a request that returns capabilities, a status, a job list or a file list, and inside the `ack` or `result` object, beside `ok: false` and a `reason` in words, for the others.

| Code | Answered when |
| --- | --- |
| `unsupported` | `pickFiles`, `read`, `exportMetainfo`, `saveFile` or `openFile`: kernl cannot reach the program's files. Also `add` with a `fileSelection` (choose with `selectFiles` once the list is known), and a program that cannot do what was asked (`unavailable:unsupported`). |
| `unsupported-mode` | `add` with mode `seed`. |
| `unsupported-source` | `add` with a `runtime-file-set` source. |
| `unsupported-format` | A v2-only magnet link, hash or torrent file. |
| `unsupported-transport` | `add` when no torrent connection can serve, or when the one the person said yes to was removed before the torrent was handed over, or with a `transport` other than `auto` or `bittorrent`. |
| `unsupported-setting` | `add` with `trackers` or `webSeeds`; `update` with a setting outside `mutableSettings`. |
| `storage-denied` | `add` with `storage` other than `persistent` (the program chooses where files go); or a persistent job could not be written to the shell's storage. |
| `invalid-magnet`, `invalid-infohash`, `invalid-source` | The source is malformed: not a magnet link or one without a hash; a hash that is not lowercase hex of the right length; a torrent file that does not parse, two sources at once, or an unknown kind. `invalid-source` is also what a program declining the torrent reads as (`unavailable:rejected`). |
| `hash-mismatch` | The torrent file's hash is not the one the applet said it expected. |
| `too-large` | A torrent file over 2 MiB (`maxMetainfoBytes`). |
| `invalid-request` | Any other malformed request; a selection naming a file the torrent does not have; an `update` with an empty patch. |
| `job-conflict` | `add` with a job id or a torrent this applet already holds. |
| `quota-exceeded` | The applet already holds 32 jobs (`maxActiveJobs`). |
| `user-denied` | The person said no to the add, or to deleting the data. |
| `policy-denied` | The window is not a live applet, or stopped being one while the person was deciding. |
| `job-not-found` | The job id is not one this window may see: unknown, another applet's, or another window's session job. Also a program that reports it does not have the torrent while changing it (`unavailable:not-found`). |
| `source-unavailable` | The program no longer has the torrent, or the job's connection was removed or is locked; removing that job then succeeds without touching any program. Also pushed as `torrent.error`, followed by `torrent.state` `error`. |
| `metadata-unavailable` | `selectFiles` before the program knows the file list; `metadata` while the program has not read the torrent or cannot say whether it is private. |
| `revision-conflict` | `update` with an `expectedRevision` that is not the current one. The result carries the current `settings`. |
| `network-error` | No program is set up (for anything but `add`), it could not be reached, did not answer in time, answered unreadably or refused kernl's sign-in. Also pushed as `torrent.error`, once per outage. |

`torrent.cancel` never fails for a well-formed request: it answers `{ ok: true, cancelled: false }`, because nothing an applet could cancel is ever pending.

**`nzb`** (NAP-NZB). The answer is `{ error: { code, message, replayUntil? } }`.

| Code | Answered when |
| --- | --- |
| `unsupported` | `files` or `read` for a job the applet owns: the shell cannot read what a downloader saved. Also a `url` source when the shell has no fetcher, an option the downloader does not honour, an action it cannot carry out at all (`cancel` on SABnzbd), and `unavailable:unsupported` from the adapter. |
| `invalid_request` | The request is not exactly what the draft describes; or the NZB document was not accepted, with the reason in words. |
| `limit_exceeded` | A document over 10 MiB (`maxNZBBytes`), a page over 100 jobs (`maxPageSize`), or a text value longer than the shell accepts. |
| `rate_limited` | The window already has 16 requests waiting. |
| `permission_denied` | The applet does not hold the grant, or lost it while the request was under way; the window is not a running applet; the person said no to an add or a delete; or a replayed result names a job that is no longer this applet's. |
| `not_found` | No such downloader, category or job for this applet, including another applet's job and one the downloader no longer has. |
| `invalid_state` | The action does not apply to the job in its present phase. |
| `conflict` | The operation key was already used for a different request. |
| `authentication_required` | The downloader refused the sign-in the shell holds for it (`denied:credentials`). |
| `unavailable` | The downloader could not be reached, or did not answer in time before a change was sent; or an NZB named by address could not be fetched. |
| `backend_rejected` | The downloader declined (`unavailable:rejected`, or an `invalid:` reason other than `invalid:state`). |
| `outcome_unknown` | A change was sent and may have been carried out: a timeout or an unreadable answer after sending, a job that could not be seen afterwards, or a shell that closed mid-change. Check the job, then ask again with the same operation key. |
| `backend_error` | Anything else went wrong before a change was sent. |

`file_changed`, `invalid_range`, `not_ready` and `mutation_failed` are in the draft and are never answered: they belong to reading files and to outcomes kernl does not produce.

**`soulseek`** (NAP-SOULSEEK). The answer is `{ error: { code, message } }`.

| Code | Answered when |
| --- | --- |
| `denied` | `read` of a finished download: kernl cannot disclose bytes it cannot reach. Also when the person said no to the window's question, the question could not be shown, or the window is not a running applet. |
| `unsupported` | `save` of a finished download (`info` reports `canSave: false`). |
| `invalid_state` | `read` or `save` of a download that has not finished; `pause` or `resume` of one that has ended. |
| `invalid_request` | A field that is missing, of the wrong type, out of range or not defined for the operation; a request id that is too long; a `read` offset past the end of the file. |
| `unavailable` | New work (`search`, `browse`, a new `download`, `resume`) when no Soulseek connection can serve, or it is unreachable or not signed in to its network. What the window already holds stays readable. |
| `not_found` | A query, file or transfer handle this window does not hold, including one issued to another window of the same applet. |
| `limit_exceeded` | The window already holds `maxQueries` searches or `maxTransfers` downloads. |
| `backend_error` | The daemon turned the request down or failed in any other way; or the query or transfer's connection was removed, is locked or has a new address ("That sharing program is no longer set up"). |

A search, a browse or a transfer that fails after it was accepted is not an error answer: the query or transfer reports it in its own state, with `peer_unavailable`, `peer_denied`, `timeout`, `limit_exceeded`, `source_changed` (the file is not the size it was listed with) or `backend_error`.

## Guard event reasons

The guard reports each non-pass decision as a `GuardEvent` with a `disposition` (`defer`, `reject`, `quarantine`, `flag`) and one of these reasons. They reach the user through `kernl.guard.events$` and the shell's guard panel. The numbers are per profile; see [Guard](../concepts/guard.md#profiles).

For an applet's port traffic these layers decide each envelope through kehto's `filterNappletMessage` before the runtime sees it ([D-020](../decisions.md#d-020)). A `reject` drops the envelope, and the applet gets no reply. A `defer` with reason `hidden:<class>` holds it until the window is visible; a `flood:burst` `defer` on port traffic drops it. A `quarantine` revokes the binding, which also stops the envelope that crossed the limit and discards what the window held. For the window-level `hello`, `defer` and `reject` hold or drop it.

kehto's runtime charges what it carries out against the same per-class budgets, at the window's focus, through the rate limiter kernl hands it (`createRuntimeRateLimiter`). A request over its budget is refused with the error `rate limit exceeded`; before [D-056](../decisions.md#d-056) the error started `firewall:`. Each refusal is reported through `permissions.onRateLimit`, and kernl turns it into a guard event with the reasons in the last two rows. The report carries nothing the applet sent.

| Reason | Emitted by | Disposition | Meaning |
| --- | --- | --- | --- |
| `flood:burst` | ingress guard (`ingress-guard.ts`) | `defer` | More messages in one second than `ingressBurst` allows. A `hello` is held; a port envelope other than a control one is dropped. |
| `flood:queue-full` | ingress guard | `reject` | More than `ingressQueue` messages over the burst. A `hello` is dropped; a port envelope other than a control one is dropped. |
| `flood:quarantine` | ingress guard | `quarantine` | `quarantineThreshold` messages in a rolling 10 s, or any message from a window already quarantined. The binding is revoked. |
| `flood:hidden-resource` | ingress guard | `quarantine` | A hidden window made more `resource.*` requests than `hiddenResourceAllowance`. The binding is revoked. |
| `size:<class>` | ingress guard | `reject` | The envelope is over the size cap for `resource:bytes`, `relay:subscribe` or `outbox:subscribe`. In the composed shell the envelope is dropped before dispatch: nothing is fetched and the applet gets no reply. |
| `hidden:<class>` | guard pipeline (`pipeline.ts`) | `defer` | A non-control port envelope from a window that is not visible. It is held and handled once the window is visible. |
| `defer:queue-full` | visibility gate (`visibility-gate.ts`) | `reject` | The hidden window already holds `deferQueue` envelopes; this one is dropped. |
| `rate:<class>` | focus-aware rate limiter (`focus-rate-limit.ts`), or kehto's runtime through `permissions.onRateLimit` | `reject`, or `flag` when the budget's action is `flag` or kehto only observes | A class budget is spent; the reason names the class, for example `rate:relay:publish`. From kernl's rate limiter the envelope is dropped; from the runtime the request is refused with `rate limit exceeded`. |
| `flood:prompts` | kehto's runtime, through `permissions.onRateLimit` | `reject` | The applet asked firewall questions more often than kehto's suggested budget, twelve a minute; the question is not put to the user. |

`flood:startup`, `runtime:<ruleId>`, `matcher:<id>`, `policy:deny` and `prompt:<ruleId>` no longer occur: they came from the rate engine kernl ran before [D-056](../decisions.md#d-056).

## Revocation reasons

`KernlHost.onRevoked(windowId, reason)` receives kehto's revocation reasons (`window-message`, `second-hello`, `invalid-hello`, `second-load`, `port-closed`, `deferred-overflow`, `host`), `quarantine` when the guard quarantined the window, `grant-narrowed` or `blocked` when the user took back a grant the window was started with or blocked the applet ([D-038](../decisions.md#d-038)), or `firewall` when a firewall answer or rule the window ran under was taken back or tightened ([D-056](../decisions.md#d-056)). See [Architecture](../concepts/architecture.md#the-mount-path).

## Related

- [API reference](./api.md): each function's JSDoc names the reasons it throws.
- [Troubleshooting](../guides/troubleshooting.md)
