# Secrets

A secret, here, is a password or a key of a service the shell signs in to for the person. The download programs are the first such services ([D-050](../decisions.md#d-050)). kernl does not decide where their sign-ins are kept: it hands them to a `SecretsProvider`, one small contract the host can put its own keeper behind ([D-052](../decisions.md#d-052)).

The reason is that the best keeper depends on where kernl runs. A page's own storage keeps a password as plain text that any script on the origin can read. A browser extension, a service on the device or a platform keychain can do better, and none of them is kernl's to pick for every host.

## The contract

| Member | What it does |
| --- | --- |
| `description` | `{ label, keeps }`: what the provider is, in a few plain words, and how it keeps things. The shell shows it; nothing else reads it. |
| `get(name)` | Resolves the secret under a name, or `undefined` when there is none. |
| `set(name, value)` | Keeps a secret under a name, replacing any that was there. |
| `delete(name)` | Forgets the secret under a name. Forgetting one that is not there succeeds. |

Names are the shell's own. The download programs use `download:<connection id>:password` and `download:<connection id>:apiKey`, where the id is the connection's own, random and never shown ([D-053](../decisions.md#d-053)). Two connections to the same program keep two passwords. A provider keeps them apart from anything else it holds and never interprets them.

`keeps` is one of three words, so the shell can say truthfully where a sign-in went:

| `keeps` | Means |
| --- | --- |
| `plain` | Kept as typed. Anything that can read the shell's storage can read it. |
| `protected` | Kept by something that guards it, such as a keychain, an extension or a service that asks before it answers. |
| `session` | Kept in memory only. Gone when the shell closes. |

Any method may reject with `unavailable:secrets`, when the keeper cannot be reached, or `denied:secrets`, when it or the person said no. A caller reads both the same way: not available now. Neither ever means "there is no secret"; that is `get` resolving `undefined`.

## The two built-ins

| Factory | `description` | Where a secret goes |
| --- | --- | --- |
| `createStorageSecrets(storage)` | `{ label: 'this device', keeps: 'plain' }` | One key per secret in the host's storage, `kernl:secrets:v1:<name>`, the value as typed. It protects nothing beyond what the storage itself does, and says so. |
| `createMemorySecrets()` | `{ label: 'this session', keeps: 'session' }` | A map in memory. Nothing is written down. |

`createKernl` uses `createStorageSecrets(host.storage)` unless the host passes `KernlOptions.secrets`. On kernl.run that is the browser's `localStorage`, so a download program's password is readable to any script running on the origin. The Settings form says "Sign-ins are kept by this device." from the description; it is `kernl.secrets`, the only part of the provider the shell's UI can reach.

With `createMemorySecrets()` a sign-in lasts until the shell closes. The settings record outlives it and still says a password is kept, so after a reload the provider has nothing for it and the connection is [locked](#locked) until the person saves the sign-in again.

## Settings never hold a secret

A download connection's record at `kernl:download-programs:v1` is `{ id, program, label, url, username?, hasPassword, hasApiKey, routingKey }`. The two flags say whether a secret is kept; the secret is not there. The flow:

1. **Saving.** `kernl.downloads.add` and `update` hand the password and key to the provider first. Only when the provider has kept them does the record say they are kept. If the provider rejects, nothing is saved and what was there before stays.
2. **Starting.** `createDownloadClients` reads each kept secret from the provider once and holds it in memory for the client that signs in with it. `kernl.downloads.ready` settles when that is done.
3. **Using.** The secret is handed to the adapter for that program and to nothing else: not to `state()`, not to the settings form, not to an applet, a prompt, an error or a log.
4. **Editing.** The form opens with empty password and key boxes. A box left empty means "the kept one", and only when the address is the one it was kept for. Change the address and the kept secret is not sent to it; it is deleted when the new address is saved without one.
5. **Removing.** `kernl.downloads.remove(id)` deletes the connection's secrets from the provider and its record from settings.

## Locked

A provider that says no is not an empty provider. When the shell starts and the provider rejects `get` for a connection's kept secret, or resolves `undefined` for a secret the settings say is kept (as `createMemorySecrets` does after a reload), kernl does not treat the connection as having no password. It lists the connection's id in `kernl.downloads.state().locked`:

- No client is offered for a locked connection, so it serves no applet. New torrents and searches go to the domain's default only while it can serve, else to the first that can; an `nzb` applet does not see that downloader.
- The settings still show the connection, marked "Sign-in locked".
- Saving the sign-in again unlocks it, once the provider accepts the secret. Removing the connection works while it is locked, when the provider accepts the delete.

`locked` describes the running shell only. It is not written to storage, so the next start asks the provider again.

## What it is not for

- **Identity keys.** They live only inside applesauce signer instances and never pass through a `SecretsProvider` ([Persistence](./persistence.md#what-is-never-persisted)).
- **Applets.** No domain reads or writes a secret. An applet cannot name a secret, learn whether one exists, or see where one is kept.
- **Everything sensitive the shell stores.** The connection helpers' credentials for direct connections are still part of `kernl:multiplayer:v1`, as typed ([D-043](../decisions.md#d-043)). Moving them behind the provider is on the [Roadmap](../roadmap.md#_2-bridge-backends).
- **Encryption at rest.** The contract says who keeps a secret, not how. A provider that reports `protected` is making a promise only it can keep.

## Related

- [Swap the secrets provider](../how-tos/swap-the-secrets-provider.md)
- [Connected programs](./download-programs.md)
- [Persistence](./persistence.md)
- [Security posture](../policies/security-posture.md)
- [`@kernlize/core`](../packages/core.md#download-programs-and-secrets)
