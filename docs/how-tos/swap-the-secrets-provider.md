# Swap the secrets provider

Keep the passwords and keys kernl signs in with somewhere better than the page's own storage: a service on the device, a browser extension, a platform keychain. This is a host change, made where you call `createKernl`; the hosted shell at kernl.run uses the default. [Secrets](../concepts/secrets.md) explains the contract and what "locked" means.

## 1. Decide what keeps them

| You have | Pass |
| --- | --- |
| Nothing better than storage | Nothing. `createStorageSecrets(host.storage)` is the default and reports `keeps: 'plain'`. |
| A reason to write nothing down, such as a kiosk or a demo | `createMemorySecrets()`. Sign-ins end with the shell. |
| A keeper of your own | A `SecretsProvider` you write, as below. |

```ts
import { createKernl, createMemorySecrets, type KernlHost } from '@kernlize/core';

declare const host: KernlHost;

const kernl = createKernl({ host, secrets: createMemorySecrets() });
kernl.secrets; // { label: 'this session', keeps: 'session' }
```

## 2. Write a provider

A provider is three async methods and a description. This one keeps secrets in a keeper service on the device, a hypothetical program that answers `GET`, `PUT` and `DELETE` at `/secrets/<name>` and asks the person before it hands anything over.

```ts
import type { SecretsProvider } from '@kernlize/core';

const KEEPER = 'http://127.0.0.1:4470/secrets/';

const unavailable = (): Error => new Error('unavailable:secrets');

/** One request to the keeper. A missing secret is an answer for `GET` and `DELETE`, and a failure for `PUT`. */
async function ask(name: string, method: 'GET' | 'PUT' | 'DELETE', body?: string): Promise<Response> {
  const response = await fetch(KEEPER + encodeURIComponent(name), { method, signal: AbortSignal.timeout(5000), ...(body === undefined ? {} : { body }) }).catch(() => {
    throw unavailable();
  });
  if (response.status === 401 || response.status === 403) throw new Error('denied:secrets');
  if (response.ok || (response.status === 404 && method !== 'PUT')) return response;
  throw unavailable();
}

export const keeperSecrets: SecretsProvider = {
  description: { label: 'the keeper on this device', keeps: 'protected' },
  async get(name) {
    const response = await ask(name, 'GET');
    if (response.status === 404) return undefined;
    return response.text().catch(() => {
      throw unavailable();
    });
  },
  async set(name, value) {
    await ask(name, 'PUT', value);
  },
  async delete(name) {
    await ask(name, 'DELETE');
  },
};
```

The rules a provider keeps:

- **`get` resolves `undefined` only when there is no secret.** When the keeper is down, slow or says no, reject. kernl reads a rejection as "not available now" and locks the connection; it would read `undefined` as "no password" and sign in without one.
- **Reject with `unavailable:secrets` or `denied:secrets`.** `unavailable:` when the keeper cannot be reached, `denied:` when it or the person refused. The Settings form has words for both. Any other rejection is handled the same way but shown as a generic failure.
- **`delete` of a name that is not there succeeds.** kernl deletes a connection's name for a field left empty on every save, and both of its names on every remove.
- **Treat a name as opaque.** Names look like `download:sabnzbd:apiKey`. Encode them for your transport; do not parse them.
- **Describe yourself truthfully.** `label` completes the sentence "Sign-ins are kept by …". Report `protected` only when something guards the secret from the page's other scripts; a provider that writes to `localStorage` under another key is `plain`.
- **Never log a value.** Not on failure either.

A keeper reached over `fetch` from a browser page meets the same two browser rules as a download program: a page loaded over `https` can call plain `http` only on this device, and the keeper has to allow the page's origin ([Let the page in](./connect-a-download-program.md#let-the-page-in)).

## 3. Pass it to `createKernl`

<!-- sample:continues -->

```ts
import { createKernl, type KernlHost } from '@kernlize/core';

declare const host: KernlHost;

const kernl = createKernl({ host, secrets: keeperSecrets });
kernl.secrets; // { label: 'the keeper on this device', keeps: 'protected' }
```

`kernl.secrets` is the description only. The provider is not reachable from the `Kernl` surface, and no applet domain reads from it.

Sign-ins saved under the previous provider stay where that provider kept them. The settings record still says a password is kept, the new provider has none, and the connection is locked until the person saves the sign-in again. To move them, read each name from the old provider and `set` it on the new one before you create the shell; the names are `download:<connection id>:password` and `download:<connection id>:apiKey`, one pair per connection in the settings record at `kernl:download-programs:v1`.

## 4. Check it

<!-- sample:continues -->

```ts
await kernl.downloads.ready;
kernl.downloads.state().locked; // ids of connections whose kept sign-in the keeper would not hand over

await kernl.downloads.add('sabnzbd', { url: 'http://localhost:8080', apiKey: 'k1' }).catch((error: Error) => error.message);
// 'denied:secrets' or 'unavailable:secrets' when the keeper refused; nothing was saved
kernl.downloads.state().connections.find((connection) => connection.program === 'sabnzbd'); // { id, program: 'sabnzbd', label: 'SABnzbd', url: 'http://localhost:8080', hasPassword: false, hasApiKey: true, routingKey }
```

Stop the keeper and reload: the connection should be listed in `locked` and marked "Sign-in locked" in Settings, and should come back when the sign-in is saved with the keeper running. `packages/core/features/download-clients.feature` has the scenarios for a provider that will not keep a secret and one that will not hand it over.

## Related

- [Secrets](../concepts/secrets.md)
- [Connect a program](./connect-a-download-program.md)
- [Build a shell with your own UX](../tutorials/build-a-shell.md)
- [Error reasons](../reference/errors.md#download-programs)
