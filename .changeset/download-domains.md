---
'@kernlize/core': minor
---

The `torrent`, `nzb` and `soulseek` domains over the person's own download programs: `createTorrentService`, `createNzbService`, `createSoulseekService`, `createDownloadClients` (`kernl.downloads`) and `createKernlDownloads`. The domains are offered only when the installed `@kehto/shell` prelude renders a binding table (`supportsDomainBindings`), or `KernlOptions.downloads.offer` says the host's own does. Passwords and keys go to a `SecretsProvider` the host can replace through `KernlOptions.secrets`; `createStorageSecrets` is the default and `createMemorySecrets` keeps them for the session only.

**Breaking.** `ConsentSummary.event` is optional: a download question is not about an event, so a `presentConsent` implementation must not assume one. `Kernl` gains the required members `downloads` and `secrets`, so anything that implements the interface itself must supply both.
