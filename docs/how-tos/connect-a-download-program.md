# Connect a program

Let applets work through a program you already run: Transmission or uTorrent, NZBGet or SABnzbd, or slskd. Through it an applet can add torrents and NZBs, follow and control their jobs, change a torrent's speed limits and sharing, and search and browse shared libraries, each as you allow. [Connected programs](../concepts/download-programs.md) explains what an applet can then do and what you are asked.

## In the shell

1. Open **Settings** and go to **Downloads**. *Connected programs* has three groups: **Peer sharing** (Transmission, uTorrent), **News archives** (NZBGet, SABnzbd) and **Shared libraries** (slskd). Each connection you saved is a row in its group.
2. In the group, open **Add a connection**. In **Peer sharing** and **News archives**, pick the **Program**.
3. Give it a **Name**, or leave it empty: it is then the program's name, numbered when another connection already has it, such as "Transmission 2". A name is up to 60 characters. You can set up any number of connections, several to the same program among them.
4. Type its **Address**: where its own web interface answers, such as `localhost:9091` or `https://downloads.example`. You can leave out `http://` or `https://`; kernl asks the program at `https` first, then at `http`, and keeps the one that answers.
5. Fill in the **sign-in** the program uses, in the fields it takes (**Username**, **Password**, **Key**):

   | Program | Sign-in | Where to find it |
   | --- | --- | --- |
   | Transmission | Username and password | Its remote-access settings (`rpc-username`, `rpc-password`). |
   | uTorrent | Username and password | Preferences, Web UI. |
   | NZBGet | Username and password | Settings, Security (`ControlUsername`, `ControlPassword`). |
   | SABnzbd | Key | Config, General, *API Key*. |
   | slskd | Key, or username and password | `web.authentication.api_keys` in its configuration, or the web sign-in. |

6. Choose **Save**. kernl first asks the program for its version. If it answers, the connection is saved, opens as its own row, and shows "Connected" with the version. If it does not, the form says why, and nothing is saved.
7. With two or more connections in **Peer sharing**, choose where **New torrents go to**; with two or more in **Shared libraries**, where **New searches go to**. The first one you added is chosen until you pick another, and removing the chosen one moves the choice to the next. **News archives** has no such choice: the applet picks among those connections by their names.

Open a row to change its name, address or sign-in, then **Save** again; **Remove** forgets it and its kept sign-in. A torrent goes to the connection that already holds that torrent for kernl, else to the chosen one, and the question before it is added names that connection. Once a torrent or a search has gone to a connection, it stays there. A torrent or search on a connection you removed, or one that is locked, is answered as no longer set up; an applet removing such a torrent succeeds and touches no program.

The address and the username are kept in this browser. The password or key goes to the shell's secrets keeper, and the line under *Connected programs* says which one: on kernl.run it reads "Programs you run that applets can work through. Sign-ins are kept by this device.", which means the browser's storage, as typed ([Secrets](../concepts/secrets.md)). A saved password or key is never shown again: its box is empty with the placeholder "Saved", and leaving it empty keeps the saved one. A saved password is used only for the address it was saved with; change the address and type it again, or it is forgotten.

A row marked **Sign-in locked** means the keeper would not hand the saved sign-in over when kernl started. Applets cannot use that connection until you save its sign-in again.

## If the check fails

| The form says | Reason | What it means | What to do |
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

After a save, a note in the row says when the address is not encrypted. "On this device, so nothing leaves it." is harmless. "Not encrypted: the password can be read on your network." means the password crosses your network in the clear every time kernl talks to the program.

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
  // The address, username and label go to settings, the password to the secrets provider. Rejects, with nothing saved, when the provider will not keep it.
  const home = await kernl.downloads.add('transmission', signIn, 'Home');
  // New torrents go here, not to the torrent connection added first.
  kernl.downloads.chooseDefault('torrent', home.id);
  if (notes.includes('cleartext')) console.warn('The password travels unencrypted.');
  return probe.version;
}
```

`check` rejects with a [reason](../reference/errors.md#download-programs) and saves nothing; pass a connection's id as its third argument to check an edit, a password or key left empty being that connection's kept one. `add` alone keeps a connection without asking the program; it takes a complete address, scheme included, and still refuses one this page may not call. Without a label it is the program's name, numbered when taken. `update(id, { label?, signIn? })` changes a connection, `remove(id)` forgets it and its kept secrets, and `chooseDefault(domain, id)` picks where new `torrent` or `soulseek` work goes. `add`, `update` and `remove` return promises.

What comes back out is never a secret:

<!-- sample:continues -->

```ts
async function describe(kernl: Kernl): Promise<void> {
  await kernl.downloads.ready; // the kept sign-ins have been asked for
  const { connections, defaults, locked } = kernl.downloads.state();
  connections[0]; // { id, program: 'transmission', label: 'Home', url: 'http://localhost:9091', username: 'me', hasPassword: true, hasApiKey: false, routingKey }
  defaults.torrent; // the id of the connection new torrents go to
  locked; // ids of connections whose kept sign-in the secrets provider would not hand over
  kernl.downloads.routing('torrent').preferred()?.connection.label; // 'Home'
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

- [Connected programs](../concepts/download-programs.md)
- [Secrets](../concepts/secrets.md)
- [Swap the secrets provider](./swap-the-secrets-provider.md)
- [Grant and revoke](./grant-and-revoke.md)
- [Error reasons](../reference/errors.md#download-programs)
