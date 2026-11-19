---
"@kernlize/core": minor
---

Applets can call remote tools. `createKernl` registers the `cvm` service as `createRemoteToolsService`: each window calls under its own key from `createWindowIdentities`, never the account's, through its own transport over the shell's pool, and the key is wiped when the window ends (D-041). `KernlOptions.remoteTools` names the relays tool servers are looked for on (the `super` tier by default) and the tool families the host vouches for. New exports: `createRemoteToolsService`, `createCvmRelayPool`, `createWindowIdentities`, `RemoteToolsOptions`, `RemoteToolsSettings`, `WindowIdentities`.
