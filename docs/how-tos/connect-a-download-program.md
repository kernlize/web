# Connect a download program

Let applets download through a program you already run: Transmission or uTorrent, NZBGet or SABnzbd, or slskd. [Download programs](../concepts/download-programs.md) explains what an applet can then do and what you are asked.

## In the shell

1. Open **Settings** and go to **Downloads**. Under *Download programs*, find the program.
2. Type its **address**: where its own web interface answers, such as `localhost:9091` or `https://downloads.example`. You can leave out `http://` or `https://`; kernl asks the program at both and keeps the one that answers.
3. Fill in the **sign-in** the program uses:

   | Program | Sign-in | Where to find it |
   | --- | --- | --- |
   | Transmission | Name and password | Its remote-access settings (`rpc-username`, `rpc-password`). |
   | uTorrent | Name and password | Preferences, Web UI. |
   | NZBGet | Name and password | Settings, Security (`ControlUsername`, `ControlPassword`). |
   | SABnzbd | Key | Config, General, *API Key*. |
   | slskd | Key, or name and password | `web.authentication.api_keys` in its configuration, or the web sign-in. |

4. Choose **Check and save**. kernl asks the program for its version. If it answers, the connection is saved and the card shows the version. If it does not, the card says why, and nothing is saved.
5. If you set up both Transmission and uTorrent, choose which one applets download through.

Addresses and sign-in details stay on this device. They are never shown again after saving: leave a password or key empty to keep the saved one. A saved password is used only for the address it was saved with; change the address and you are asked for it again.

## If the check fails

| The card says | What it means | What to do |
| --- | --- | --- |
| A secure page cannot reach an address that is not secure | You opened kernl over `https` and typed an `http` address on another machine. Browsers block that. | Give the program an `https` address (a reverse proxy with a certificate), or reach it at `localhost` if it runs on this device. |
| kernl could not reach the program | Nothing answered, or the browser blocked the answer. | Check the program is running and the address and port are right. Check the sign-in too: NZBGet answers a wrong password in a way a browser hides from the page, so it looks the same as no answer. If all of that is right, the program is not letting this page in: see [Let the page in](#let-the-page-in). |
| The program refused the name, password or key | It answered. The sign-in is wrong. | Check it in the program's own settings. |
| Something answered, but not the way this program does | Another service is at that address, or a path is missing. | Check the port, and any path the program is served under, such as `/sabnzbd`. |

A note under a saved connection tells you when the address is not encrypted. On this device that is harmless. On another machine it means the password crosses your network in the clear every time kernl talks to the program.

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
  const { connection, notes, probe } = await kernl.downloads.check('transmission', { url: 'localhost:9091', username: 'me', password: 'secret' });
  kernl.downloads.save('transmission', connection);
  if (notes.includes('cleartext')) console.warn('The password travels unencrypted.');
  return probe.version;
}
```

`check` rejects with a [reason](../reference/errors.md#download-programs) and saves nothing. `save` alone keeps a connection without asking the program, and still refuses an address this page may not call. `remove(program)` forgets one, and `chooseTorrent(program)` picks between two torrent programs.

A host outside a browser passes its own `fetch` and says how it is served:

```ts
import { createKernl, type KernlHost } from '@kernlize/core';

declare const host: KernlHost;

const kernl = createKernl({ host, downloads: { fetch: (input, init) => fetch(input, init), pageScheme: () => 'https' } });
```

## Related

- [Download programs](../concepts/download-programs.md)
- [Grant and revoke](./grant-and-revoke.md)
- [Error reasons](../reference/errors.md#download-programs)
