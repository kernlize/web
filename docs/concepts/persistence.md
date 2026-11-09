# Persistence

kernl keeps the user's choices in the browser they made them in. There is no kernl server and no kernl account. The one exception is the user's own: with **Keep these choices with your account** on, the applets they chose for each kind of request are published to their account's relays ([The store and intents](./store-and-intents.md#the-users-preferred-handlers)). This page lists every key kernl writes, what each holds, and what is deliberately never written.

## Where values go

`@kernlize/core` never touches `localStorage` itself. It writes to `KernlHost.storage`, a `StorageLike` (`getItem`, `setItem`, `removeItem`) the host supplies. The shell app supplies `pickStorage()` from `apps/web/src/shell/host.ts`: `localStorage` when a probe write succeeds, otherwise a `Map` that lives as long as the page. In a private window that refuses storage, the shell still works and forgets everything on reload.

Inside the core, every key goes through `createNamespacedStore(storage, 'kernl')`, which prefixes each key with `kernl:` and stores JSON:

| Method | Behaviour |
| --- | --- |
| `getJson(key, fallback)` | Reads `kernl:<key>` and parses it. Returns `fallback` when the key is absent or the JSON is corrupt; it never throws, so a damaged value cannot stop the shell from booting. |
| `setJson(key, value)` | Serialises and writes `kernl:<key>`. |
| `remove(key)` | Removes `kernl:<key>`. |

The prefix keeps kernl's keys apart from kehto's and from the host app's in the same storage. Every key carries a `:v1` suffix so a future format can move to `:v2` without reading the old one wrongly.

## Keys the core writes

| Key | Written by | Holds |
| --- | --- | --- |
| `kernl:accounts:v1` | `createKernlAccounts` | applesauce's `AccountManager.toJSON(true)`: the serialised accounts, minus any that cannot be serialised. Rewritten whenever the account list changes. |
| `kernl:active-account:v1` | `createKernlAccounts` | The active account's id. Removed when no account is active. |
| `kernl:grants:v1` | `createGrants` | One record per verified applet build, keyed `<dTag>:<hash>`: `{ dTag, hash, domains, blocked }`. See [Identity and grants](./identity-and-grants.md). |
| `kernl:relays:v1` | `createRelayTiers` | The four relay tiers, each a list of URLs. See [Relay tiers](./relay-tiers.md). |
| `kernl:messaging:v1` | `createDefaultMessaging` | `MessagingPreferences`: the `enabled` provider ids and the optional `defaultProvider`. See [Messaging](./messaging.md). |
| `kernl:installed:v1` | `createInstalledApplets` | The installed applets: `{ catalogId, address, title, publisher, contracts, installedAt }` each, where `contracts` are the roles and requests from the verified manifest. See [The store and intents](./store-and-intents.md#installing). |
| `kernl:intent-defaults:v1` | `createHandlerDefaults` | The user's default applet per role, `{ <role>: <catalogId> }`, on this device. |
| `kernl:intent-sync:v1` | `createHandlerDefaults` | `true` when the user chose to publish their choices with their account; absent or `false` otherwise. |
| `kernl:event-cache:v1` | `createSqliteOpfsCacheAdapter` | The event cache's current database filename, written only after a damaged database could not be wiped and the cache moved to a new file. Absent means `/kernl-events.sqlite3`. See [Events kept between visits](#events-kept-between-visits). |
| `kernl:firewall:v1` | `createRuntimeFirewallHooks`, as kehto's `firewallPersistence` | kehto's serialised runtime firewall configuration: the per-applet rates kernl installs, the unfocused multiplier and the startup burst guard. Counters are never stored. kehto writes it whenever kernl changes the configuration and loads it when the bridge is created; kernl reapplies the profile on every boot, so a stored value never loosens the profile in force. The string is kehto's format and is written as is, not through `createNamespacedStore`. See [Guard](./guard.md#where-enforcement-happens). |

On boot, `createKernlAccounts` restores the accounts and makes the stored id active if that account still exists. `createGrants` loads its records, and `createRelayTiers` and `createDefaultMessaging` start from the stored value when there is one.

## Keys the shell app writes

| Key | Written by | Holds |
| --- | --- | --- |
| `kernl:recent:v1` | `recent.ts`, through the host storage | The recently opened applets: up to eight `{ address, title, publisher, openedAt }`, newest first. Opening an applet moves it to the front; the launcher can forget one. |
| `kernl:layout:v1` | `windows.ts`, through the host storage | The id of the layout the person chose, as a plain string: `floating`, `dwindle`, `columns`, `master-stack`, or one a developer registered. An id nobody registered is ignored and the first layout is used; `tiled`, which earlier builds stored, reads as `dwindle`. See [Layouts](./layouts.md). |
| `kernl:preview:grants:v1`, `kernl:preview:relays:v1`, `kernl:preview:messaging:v1`, `kernl:preview:installed:v1`, `kernl:preview:intent-defaults:v1` | the offline preview (`?preview=1`) | The preview's own grants, tiers, messaging preferences, installed applets and default applets, kept apart so that trying the preview never changes the live shell's state. |

The public website also remembers its colour scheme as `kernl-theme` (`light` or `dark`). That key belongs to the site pages, not to the shell.

## Keys kehto writes

Apart from the runtime firewall's configuration above, kernl passes no persistence hooks of its own to `createShellBridge`, so kehto uses its defaults from `@kehto/shell`, which write to `localStorage` directly rather than to `host.storage`. In `@kehto/shell` 0.32.0 those are `napplet:acl` (the runtime ACL, which `kernl:grants:v1` mirrors per applet build; kernl's `aclDefaultPolicy: 'restrictive'` replaces the policy stored there on load), `napplet:manifest-cache`, `napplet-shell-secret`, `napplet-guid:<windowId>`, and the scoped keys behind the `storage` NAP domain, where an applet's own data lives. kernl does not read or migrate these keys; their format is kehto's.

## Events kept between visits

Settings are small and live in `StorageLike`. Events are many and live in an event cache, `@kernlize/core/cache` ([D-027](../decisions.md#d-027)). One contract, `EventCacheAdapter`, has a backend per context, and `openEventCache` uses the first that opens here. In a browser that is sqlite over the origin-private file system, then IndexedDB, then memory; a server or a native host brings its own database through `fromEventDatabase` ([Add a cache backend](../how-tos/add-a-cache-backend.md)).

The cache is an accelerator, never identity. Nothing in it is the only copy of anything: every event came from a relay and can be fetched again. A loader that asks the cache and gets an error is answered with nothing and asks the relays, and events read from the cache enter the event store marked as from the cache, so they are never written back.

### What the cache keeps

Every backend keeps the same rules, because they live in one layer above the backend: only the newest version of a replaceable or addressable event; nothing a kind 5 deletion by its author named, now or later; no ephemeral events.

### Where the browser keeps it

| Backend | Where | When it is used |
| --- | --- | --- |
| `sqlite-opfs` | `/kernl-events.sqlite3` in the SAH pool of the origin-private file system, run by sqlite-wasm in a dedicated worker | The page can start a worker and has OPFS, and no other tab holds the database. The SAH pool needs no cross-origin isolation. |
| `indexeddb` | The IndexedDB database `kernl-events` | sqlite is unavailable, locked by another tab, or damaged beyond repair. |
| `memory` | The page | Neither of the above opens, as in a private window that refuses storage. Gone on reload. |

A Web Lock named after the database file keeps the sqlite cache to one tab. A second tab does not wait: it uses IndexedDB, so two tabs keep two caches.

### When the database is damaged

A sqlite file can be damaged by a crash during a write, a storage fault, or a browser that cleared part of the origin. The cache never reads a damaged database.

1. **Detect.** Opening runs `PRAGMA quick_check`. Damage is a check that does not answer `ok`, or any error that says `SQLITE_CORRUPT`, `SQLITE_NOTADB`, `database disk image is malformed` or `file is not a database`. A busy or full database is not damage and is reported as it is.
2. **Wipe.** The cache closes the file, removes it and its journal from the SAH pool, and opens it fresh. `onRecover` hears `wiped`.
3. **Rotate.** When the pool cannot remove the file, or the fresh file is damaged too, the cache opens the next name, `/kernl-events-1.sqlite3`, and keeps that name at `kernl:event-cache:v1` so the next visit opens it directly. `onRecover` hears `rotated`.
4. **Give up.** When the new file is damaged as well, `onRecover` hears `disabled`. During open, the adapter rejects `unavailable:corrupt` and `openEventCache` moves on to IndexedDB. During use, every later call is refused with `unavailable:corrupt`, which a loader reads as an empty answer.

Damage met while the cache is in use goes through the same steps. Calls that meet it at the same moment share one repair, and each is tried once more on the repaired file; a call that fails again reports its error. A repair empties the cache, and the relays fill it again.

## What is never persisted

- **Plaintext private keys.** `KernlAccountManager.addAccount` refuses the account types whose serialised form carries a raw secret (`PLAINTEXT_KEY_ACCOUNT_TYPES`: `nsec` and `seed-words`) with `denied:plaintext-key-persistence`, and restore drops any such entry it finds in storage. The only stored form of a local key is applesauce's `PasswordAccount`, whose `ncryptsec` is NIP-49 encrypted with the user's password. The password itself is never stored.
- **The preview account.** "Try the preview" creates a throwaway key account in a plain `AccountManager` that is not connected to storage, so it disappears on reload.
- **The guard profile.** `GuardFacade.setProfile` changes the profile for the running shell only. Every boot starts `strict` ([D-003](../decisions.md#d-003)).
- **Open windows.** The window manager persists only the layout. Applets are not reopened on reload; the recent list is how the user gets back to them.

Some stored values are sensitive even though they are not the user's key. A browser-extension account stores only its public key, because the extension holds the secret. A remote-signer account stores what applesauce needs to reconnect: the remote signer's public key, its relays, the pairing secret when there is one, and the client key of the pairing session in hex. That client key is not the user's identity key, but anyone who reads it from this browser's storage can talk to the remote signer as this session until the user revokes the pairing in the signer.

## Clearing it

Signing out clears the active account and keeps the account in the list, so it can be picked again. **Forget** on the sign-in screen removes a stored account. Removing everything kernl stored means clearing the site's storage in the browser. Nothing is held anywhere else, so there is nothing else to delete.

## Related

- [Identity and grants](./identity-and-grants.md)
- [Relay tiers](./relay-tiers.md)
- [Alpha status](../alpha-status.md#what-does-not-work-yet)
