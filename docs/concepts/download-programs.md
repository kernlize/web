# Download programs

An applet cannot join a swarm, talk to a news server or search a sharing network: its frame has no network at all. A page cannot either, for most of these, because a browser gives it no raw sockets. The programs people already run for this can. kernl drives them through their own HTTP APIs, for the applets the person allows, behind three NAP domains ([D-050](../decisions.md#d-050)).

| Domain | Draft | Programs | Adapter (`@kernlize/bridges`) | Service (`@kernlize/core`) |
| --- | --- | --- | --- | --- |
| `torrent` | [NAP-TORRENT](https://github.com/napplet/naps/pull/72) | Transmission, uTorrent | `createTransmissionClient`, `createUtorrentClient` | `createTorrentService` |
| `nzb` | [NAP-NZB](https://github.com/napplet/naps/pull/136) | NZBGet, SABnzbd | `createNzbgetClient`, `createSabnzbdClient` | `createNzbService` |
| `soulseek` | [NAP-SOULSEEK](https://github.com/napplet/naps/pull/135) | slskd | `createSlskdClient` | `createSoulseekService` |

This is separate from [bridges](./bridges.md). A bridge resolves a link the person opens, such as a magnet link pasted into the Downloads panel, and for magnet links kernl can do the transfer itself in the page ([D-017](../decisions.md#d-017)). A download domain is an interface an applet calls, and the transfer happens in a program on the person's machine or network.

## Two layers

```text
applet ──torrent.add──▶ service (core) ──TorrentClient.add──▶ adapter (bridges) ──HTTP──▶ Transmission
        NAP wire format                    one contract per kind                 the program's own API
```

**An adapter** knows one program. It normalises that program's API to a contract, `TorrentClient`, `NzbClient` or `SoulseekClient`, and rejects with one of a fixed set of [reasons](../reference/errors.md#download-programs): the program could not be reached, did not answer in time, refused the sign-in, answered with something unreadable, declined the request, does not know the job, cannot do what was asked, or may have applied a change that could not be confirmed. Nothing above an adapter sees a method name, an id or a path of the program's.

**A service** knows one NAP. It validates every request, owns the handles an applet is given, asks the person, and maps what the adapter reports onto the draft's states and errors. It is a kehto `ServiceHandler`.

## What an applet can and cannot do

The services are remote controls. kernl can ask the program to start, pause, resume and remove a transfer and can read its progress. It cannot read the files the program wrote, because they are on that program's disk. So each domain answers honestly for the operations that would need the bytes:

| Domain | Works | Answers "unsupported" |
| --- | --- | --- |
| `torrent` | `capabilities`, `add` (magnet, info hash, metainfo), `status`, `jobs`, `files`, `selectFiles`, `pause`, `resume`, `remove`, `metadata`, `update` (speed limits, keep sharing after finishing), and the `state`, `progress` and `error` pushes | `pickFiles`, `read`, `exportMetainfo`, `saveFile`, `openFile`, seeding files from this device, v2-only torrents. `cancel` answers that nothing was pending. |
| `nzb` | `downloaders`, `add` (bytes, or an `https` address the shell fetches under the [web bridge](./bridges.md#the-http-bridge)'s policy), `jobs`, `status`, `control` for the actions the program can carry out | `files`, `read`. Every downloader reports `canReadFiles: false`. |
| `soulseek` | `info`, `search`, `browse`, `results`, `stop`, `download`, `transfers`, `status`, `pause`, `resume`, `cancel`, `release` | `save` (`canSave` is false). `read` is `denied`: the shell cannot disclose bytes it cannot reach. |

Each domain says this in its discovery call (`torrent.capabilities`, `nzb.downloaders`, `soulseek.info`), so an applet can find out before it tries.

## What the person controls

- **Which applets.** Each domain is a grant like any other, off until the person switches it on for that applet. An applet that can read messages holds none of the three ([D-046](../decisions.md#d-046)).
- **Each download.** The person is asked before every torrent or NZB an applet adds, before a window's first search or download through the sharing daemon, and before anything is deleted. The prompt says what peers or servers will see.
- **What an applet sees.** Only what it started. A torrent the person added themselves, or one another applet added, does not exist as far as it can tell. Handles are the shell's own; an applet never sees the program's ids, its address or its category names.
- **What happens when an applet closes.** A torrent added for the session is paused in the program, not removed. A torrent the applet asked to keep, and every NZB, carries on in the program, and the prompt said so. Searches and unfinished transfers through the sharing daemon are stopped, as that draft requires, and finished files stay where the daemon put them. Closing an applet deletes nothing, and kernl never removes from the person's program something it was not asked to.

## Connection settings

`kernl.downloads` (`createDownloadClients`) holds what the person set up. Per program, the settings record at `kernl:download-programs:v1` is `{ url, username?, hasPassword, hasApiKey }`: the address, the name, and whether a password or a key is kept. The password and the key themselves are not in it. They go to the [secrets provider](./secrets.md), are read from it once when the shell starts, and are held in memory for the client that signs in with them and for nothing else ([D-052](../decisions.md#d-052)). [Connect a download program](../how-tos/connect-a-download-program.md) is the walk-through.

| Call | What it does |
| --- | --- |
| `check(program, typed)` | Works out the scheme, checks the address, asks the program for its version. Resolves `{ signIn, notes, probe }`; saves nothing. A password or key left empty is the kept one, when the address is the one it was kept for. |
| `save(program, signIn)` | Hands the secrets to the provider, then writes the record. Resolves when both are done; rejects, with nothing saved, when the address may not be used or the provider will not keep the secret. |
| `remove(program)` | Deletes the program's secrets from the provider and its record. |
| `chooseTorrent(program)` | Picks which of the two torrent programs serves applets. The first one set up serves until the person chooses. |
| `state()`, `state$` | `{ connections, torrentProgram?, locked }`. |

`locked` lists the programs whose kept sign-in the provider would not hand over when the shell started. A locked program serves no applet until the person saves its sign-in again; a provider that says no is never read as "there is no password".

### The address is checked against how kernl was loaded

A browser will not let a page loaded over `https` call a plain `http` address, unless that address is the same device. So before an address is saved or used, `checkClientEndpoint(address, pageScheme)` decides:

| kernl loaded over | Address | Verdict |
| --- | --- | --- |
| `https` | `https://…` | Fine. |
| `https` | `http://` on this device (`localhost`, `*.localhost`, `127.0.0.0/8`, `[::1]`) | Fine, noted as `cleartext-loopback`: nothing leaves the machine. |
| `https` | `http://` anywhere else | Refused, `invalid:mixed-content`. |
| `http` | `http://` on this device | Fine, `cleartext-loopback`. |
| `http` | `http://` anywhere else | Allowed with the note `cleartext`: the password travels unencrypted. |
| `http` | `https://…` | Allowed with the note `page-insecure`: the program's address is encrypted, the page it is typed into is not. |

An address typed without a scheme, such as `nas.local:9091`, has it worked out: `detectClientEndpoint` asks the program at `https` first and then at `http`, leaving out whichever the page may not call. A program that answers but refuses the sign-in ends the search at once, so credentials are not then offered to a second address. Sign-in details in the address itself (`http://name:pass@host`) are refused; they have their own fields. Settings read back from storage go through the same check and are dropped when they no longer pass, for instance when the same browser profile later opens kernl over `https`.

### The program has to let the page in

The scheme check is not the browser's only rule. A page on one origin may call a program on another only if the program's answers say so (cross-origin resource sharing). Measured against the programs themselves:

| Program | From a page on another origin |
| --- | --- |
| SABnzbd | Works. Its API answers allow any origin (`Access-Control-Allow-Origin: *`). |
| NZBGet | Works with the right sign-in. A wrong password is answered without the headers, so the browser hides the answer and the failure reads as "could not be reached" (`unavailable:unreachable`), not as a refused sign-in. |
| slskd | Works. It allows the calling origin and its key header. |
| Transmission | Blocked. Its API sends no such headers. Put a reverse proxy in front that adds them. |
| uTorrent | Blocked, and it signs in with a cookie a page on another site does not send. Serve it through a reverse proxy on the same site as kernl. |

A host that embeds `@kernlize/core` outside a browser has neither rule: it passes its own `fetch` as `KernlOptions.downloads.fetch`.

### What was run against the real programs

| Program | Version | Checked |
| --- | --- | --- |
| Transmission | 4.1.4 | The adapter against the daemon, and the reverse proxy in the how-to in front of it. |
| NZBGet | 26.3 | The adapter against the program, and its answers to a page on another origin. |
| SABnzbd | 5.1.3 | The same. |
| slskd | 0.26.2 | The adapter against the daemon and its answers to a page on another origin. Search results and transfers could not be observed without a network login. |
| uTorrent | not run | The adapter follows the documented WebUI API. |

## When the domains are offered

An applet reaches the shell only through the message port that kehto's injected prelude keeps to itself, and `@kehto/shell` 0.35 builds a domain it does not know as an empty object. A domain an applet can see but cannot call would be a promise the shell cannot keep, so kernl offers `torrent`, `nzb` and `soulseek` only when the installed prelude renders a binding table for a domain ([kehto/web#413](https://github.com/kehto/web/pull/413)); `supportsDomainBindings()` is the test. Until then the settings are there, the services are not registered, and the store treats an applet that requires one of the domains as it treats any applet this shell cannot run. `KernlOptions.downloads.offer` overrides the test for a host whose own prelude binds the domains.

When they are offered, kernl adds the granted ones to the environment it sets for the window at mount, which is what kehto's runtime reads to admit a domain it does not build in, and hands the prelude `DOWNLOAD_BINDINGS`.

## Related

- [Connect a download program](../how-tos/connect-a-download-program.md)
- [Secrets](./secrets.md)
- [Bridges](./bridges.md)
- [Identity and grants](./identity-and-grants.md)
- [`@kernlize/bridges`](../packages/bridges.md), [`@kernlize/core`](../packages/core.md)
