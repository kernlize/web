---
'@kernlize/bridges': minor
---

Adapters that drive the download programs a person already runs, each through the program's own HTTP API: `createTransmissionClient` and `createUtorrentClient` (`TorrentClient`), `createNzbgetClient` and `createSabnzbdClient` (`NzbClient`), and `createSlskdClient` (`SoulseekClient`). Every method rejects with one of the `ClientFailure` reasons. `checkClientEndpoint`, `endpointCandidates` and `detectClientEndpoint` check a program's address against how the page was loaded and work out its scheme; `readTorrentMetainfo` and `magnetInfoHash` read a v1 info hash from a `.torrent` file or a magnet link.
