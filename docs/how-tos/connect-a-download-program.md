# Connect a download program

Let applets download through a program you already run: Transmission or uTorrent, NZBGet or SABnzbd, or slskd. [Download programs](../concepts/download-programs.md) explains what an applet can then do and what you are asked.

## In the shell

1. Open **Settings** and go to **Downloads**. Under *Download programs*, find the program.
2. Type its **address**: where its own web interface answers, such as `localhost:9091` or `https://downloads.example`. You can leave out `http://` or `https://`; kernl asks the program at `https` first, then at `http`, and keeps the one that answers.
3. Fill in the **sign-in** the program uses:

   | Program | Sign-in | Where to find it |
   | --- | --- | --- |
   | Transmission | Name and password | Its remote-access settings (`rpc-username`, `rpc-password`). |
   | uTorrent | Name and password | Preferences, Web UI. |
   | NZBGet | Name and password | Settings, Security (`ControlUsername`, `ControlPassword`). |
   | SABnzbd | Key | Config, General, *API Key*. |
   | slskd | Key, or name and password | `web.authentication.api_keys` in its configuration, or the web sign-in. |

4. Choose **Save**. kernl first asks the program for its version. If it answers, the connection is saved and the card shows "Connected" with the version. If it does not, the card says why, and nothing is saved.
5. If you set up both Transmission and uTorrent, choose which one applets download through.

The address and the name are kept in this browser. The password or key goes to the shell's secrets keeper, and the line above the cards says which one: on kernl.run it reads "Sign-ins are kept by this device.", which means the browser's storage, as typed ([Secrets](../concepts/secrets.md)). A saved password or key is never shown again: its box is empty with the placeholder "Saved", and leaving it empty keeps the saved one. A saved password is used only for the address it was saved with; change the address and type it again, or it is forgotten.

A card marked **Sign-in locked** means the keeper would not hand the saved sign-in over when kernl started. Applets cannot use that program until you save its sign-in again.

## If the check fails

| The card says | Reason | What it means | What to do |
| --- | --- | --- | --- |
| kernl is open over https, so the address must be https too, or on this device. | `invalid:mixed-content` | You opened kernl over `https` and typed an `http` address on another machine. Browsers block that. | Give the program an `https` address (a reverse proxy with a certificate), or reach it at `localhost` if it runs on this device. |
| No answer. Check the address, the sign-in, and that the program accepts this page. | `unavailable:unreachable` | Nothing answered, or the browser blocked the answer. | Check the program is running and the address and port are right. Check the sign-in too: NZBGet answers a wrong password in a way a browser hides from the page, so it looks the same as no answer. If all of that is right, the program is not letting this page in: see [Let the page in](#let-the-page-in). |
| The program did not answer in time. | `unavailable:timeout` | It took longer than 15 seconds. | Try again; check the machine it runs on. |
| The program refused that sign-in. | `denied:credentials` | It answered. The name, password or key is wrong. | Check it in the program's own settings. |
| Something else answered at that address. | `unavailable:bad-response` | Another service is at that address, or a path is missing. | Check the port, and any path the program is served under, such as `/sabnzbd`. |
| The sign-in could not be kept. Nothing was saved. | `denied:secrets`, `unavailable:secrets` | The program answered, and the secrets keeper would not take the password or key. | The default keeper never answers this way. With another, check that it is running and allows kernl. |
| Enter an address, such as localhost:9091. | `invalid:address` | The address is empty, is not one, or has a `?` or `#` in it. | Type the host and port, and a path if the program is served under one. |
| Put the name and password in their own fields. | `invalid:credentials-in-address` | The address has the form `http://name:pass@host`. | Remove them from the address. |
| That did not work. Check the address. | anything else | The program declined, or failed in a way the form has no words for. | Check the address, then the program's own log. |

After a save, a note under the card says when the address is not encrypted. "On this device, so nothing leaves it." is harmless. "Not encrypted: the password can be read on your network." means the password crosses your network in the clear every time kernl talks to the program.

## Let the page in

A browser lets a page call a program on another address only if the program's answers allow that page's origin. SABnzbd, NZBGet and slskd do. Transmission and uTorrent do not, so they need a reverse proxy in front that adds the permission and, if kernl is on `https`, a certificate.

With [Caddy](https://caddyserver.com), for Transmission, where `https://kernl.run` is the address you open kernl at:

```text
downloads.example {
	@preflight method OPTIONS
	header {
		Access-Control-Allow-Origin "https://kernl.run"
		Access-Control-Allow-Headers "Authorization, Content-Type, X-Transmission-Session-Id"
		Access-Control-Expose-Headers "X-Transmission-Session-Id"
		Access-Control-Allow-Methods "POST, OPTIONS"
		Access-Control-Max-Age "600"
		Vary "Origin"
		defer
	}
	respond @preflight 204
	reverse_proxy 127.0.0.1:9091
}
```

Name your own origin, not `*`: the program is signed in to with a password, and any page you visit could otherwise try it. Then give kernl the address `https://downloads.example`. Transmission also checks the host name it is called by; add yours to its `rpc-host-whitelist`.

uTorrent signs in with a cookie, which a browser does not send from a page on a different site. Serve it under the same site as kernl, for example at a path of the host that serves your own copy of the shell ([Deploy](./deploy.md)), and give kernl that address.

## In code

`kernl.downloads` is the same store the Settings form uses.

```ts
import type { Kernl } from '@kernlize/core';

async function connectTransmission(kernl: Kernl): Promise<string> {
  // Works out http or https, checks it against how the page was loaded, and asks the program for its version.
  const { signIn, notes, probe } = await kernl.downloads.check('transmission', { url: 'localhost:9091', username: 'me', password: 'secret' });
  // The address and name go to settings, the password to the secrets provider. Rejects, with nothing saved, when the provider will not keep it.
  await kernl.downloads.save('transmission', signIn);
  if (notes.includes('cleartext')) console.warn('The password travels unencrypted.');
  return probe.version;
}
```

`check` rejects with a [reason](../reference/errors.md#download-programs) and saves nothing. `save` alone keeps a connection without asking the program; it takes a complete address, scheme included, and still refuses one this page may not call. `remove(program)` forgets a program and its kept secrets, and `chooseTorrent(program)` picks between two torrent programs. `save` and `remove` return promises.

What comes back out is never a secret:

<!-- sample:continues -->

```ts
async function describe(kernl: Kernl): Promise<void> {
  await kernl.downloads.ready; // the kept sign-ins have been asked for
  const { connections, locked } = kernl.downloads.state();
  connections.transmission; // { url: 'http://localhost:9091', username: 'me', hasPassword: true, hasApiKey: false }
  locked; // programs whose kept sign-in the secrets provider would not hand over
  kernl.secrets; // { label: 'this device', keeps: 'plain' } with the default provider
}
```

A host outside a browser passes its own `fetch` and says how it is served. `secrets` is where it puts a keeper of its own ([Swap the secrets provider](./swap-the-secrets-provider.md)):

```ts
import { createKernl, type KernlHost } from '@kernlize/core';

declare const host: KernlHost;

const kernl = createKernl({ host, downloads: { fetch: (input, init) => fetch(input, init), pageScheme: () => 'https' } });
```

## Related

- [Download programs](../concepts/download-programs.md)
- [Secrets](../concepts/secrets.md)
- [Swap the secrets provider](./swap-the-secrets-provider.md)
- [Grant and revoke](./grant-and-revoke.md)
- [Error reasons](../reference/errors.md#download-programs)
