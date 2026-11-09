# Relay tiers

The shell, not the applet, decides which relays a request goes to. It sorts its relays into four tiers, routes each request to one tier by the kinds it asks for, and lets the user edit every tier in Settings. Applets never name a relay for an ordinary query or publish; the one exception is a scoped relay a window opens for itself, described at the end of this page.

## The four tiers

kehto's `RelayConfigHooks` knows three tiers: `discovery`, `super` and `outbox`. kernl adds a fourth, `apps`, for applet manifests. The `RelayTier` type is the union of the four names.

| Tier | Settings label | What it serves | Default relays (`DEFAULT_RELAY_TIERS`) |
| --- | --- | --- | --- |
| `discovery` | Discovery | Profiles, follow lists and relay lists (kinds `0`, `3`, `10002`) | `wss://purplepag.es`, `wss://relay.nos.social` |
| `apps` | Applet catalogue | Applet manifests (kehto's `NAPPLET_KINDS`, `5129`, `15129` and `35129`, plus the legacy catalogue kind `32267`) | `wss://relay.napplet.soy` |
| `outbox` | Your connections | Where what the user publishes is delivered | none |
| `super` | General | Everything that is not discovery or manifests | `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.primal.net` |

`DEFAULT_RELAY_TIERS` is exported from `@kernlize/core` as a frozen `TierMap`, each tier a frozen array. The outbox tier starts empty: kernl does not guess where the user publishes.

## How a request picks a tier

`selectRelayTier(tiers, filters)` in `packages/core/src/applesauce/relay-hooks.ts` collects the kinds of every filter and chooses:

1. If any filter has no `kinds`, or an empty `kinds`, the request cannot be classified and takes the general path.
2. If every kind is `0`, `3` or `10002`, the request goes to the `discovery` tier together with `outbox` and `super`: indexers hold most profiles and lists, and NIP-65 puts them on their authors' own servers too.
3. If every kind is an applet-manifest kind, the request goes to the `apps` tier.
4. Otherwise it goes to `super` and `outbox` together.

The result is deduplicated. A request that mixes a profile kind and a note kind is not split; it takes the general path as a whole.

<!-- sample:skip illustrative calls; the tiers object comes from createKernl or createRelayTiers -->
```ts
selectRelayTier(tiers, [{ kinds: [0], authors: [pubkey] }]); // discovery, outbox and super
selectRelayTier(tiers, [{ kinds: [35129] }]);                 // tiers.get().apps
selectRelayTier(tiers, [{ kinds: [1] }]);                     // super, then outbox
selectRelayTier(tiers, [{ ids: [id] }]);                      // super, then outbox: no kinds
```

The same function is used everywhere the shell picks relays on its own:

- kehto's relay service asks `RelayPoolHooks.selectRelayTier`, which `createRelayPoolHooks` answers with this function.
- kernl's applesauce relay backend (`relay-backend.ts`) uses it for a subscription or query that names no relays, and for every publish, by the published event's kind. A published profile therefore goes to the discovery tier and the user's own and general servers, and a published note to `super` plus `outbox`. A publish succeeds when any relay accepts it; when none does it fails with `unavailable:not-accepted:0/<n>` (D-027).
- Manifest lookups (`fetchManifestEvent`) ask the relays named in the applet's address plus the whole `apps` tier, and fall back to the `super` tier when those do not produce the manifest. One relay failing does not fail the lookup, and a relay that answers quickly with nothing does not end a round before a slower one has had `MANIFEST_TIMING.patienceMs` to answer ([D-025](../decisions.md#d-025)).
- The destructive-write consent lookup, which fetches the current version of a replaceable event before the user is asked, asks `outbox` plus `discovery`.

## Where the configuration lives

`createRelayTiers(storage, defaults?)` builds the configuration and returns a `RelayTiers`: `get()`, `add(tier, url)`, `remove(tier, url)` and `changes$`. `createKernl` calls it with `host.storage` and `KernlOptions.relays`, and exposes it as `kernl.relays`.

- **Persistence key.** The whole map is written as JSON to `kernl:relays:v1` (the key `relays:v1` in a `createNamespacedStore` with prefix `kernl`) on every change. See [Persistence](./persistence.md).
- **Start-up.** When `kernl:relays:v1` holds a value, each tier it names replaces the default for that tier and any tier it lacks keeps `DEFAULT_RELAY_TIERS`. The host's `KernlOptions.relays` is applied over the defaults only when nothing is persisted, so once the user has edited a tier, the host's overrides no longer apply on that device. A corrupt value reads as absent.
- **Validation.** `add` accepts only `ws://` or `wss://` followed by non-space characters and throws `invalid:relay-url` for anything else. Adding a URL a tier already holds does nothing. `remove` of a URL the tier does not hold does nothing.
- **Observation.** `changes$` is an RxJS `BehaviorSubject`, so a new subscriber receives the current map at once. Every value it emits is frozen.

## How Settings edits them

The shell's Settings panel (`apps/web/src/shell/SettingsPanel.svelte`) has a Network section with one block per tier, labelled as in the table above. It subscribes to `kernl.relays.changes$`, lists each server by name with a Remove button that calls `kernl.relays.remove`, and has a "Server address" field that calls `kernl.relays.add`. A bare hostname is given the secure scheme before it is added (`serverAddress` in `servers.ts`), so typing `relay.example` stores `wss://relay.example`. When `add` throws an `invalid:` reason the panel asks for a server address; any other failure says the server could not be added.

The panel never shows the word relay or a protocol scheme to the user ([Public vocabulary](../policies/public-vocabulary.md)). A change takes effect for the next request; subscriptions already open keep the relays they were opened with.

The offline preview keeps its own tier state at `kernl:preview:relays:v1`, so editing tiers in the preview never changes the live shell's.

## Scoped relays

kehto lets a window open one relay of its own choosing, the NIP-29 group pattern. `createRelayPoolHooks` keeps this minimal: one open subscription per window, replaced when the window opens another, closed with the window, and events delivered to that window's port only. Publishing to the scoped relay goes to that one relay. Tiers do not apply to scoped relays.

## Related

- [Architecture](./architecture.md)
- [Persistence](./persistence.md)
- [Inbox, outbox and finding servers](./inbox-outbox-and-servers.md)
- [`@kernlize/core`](../packages/core.md)
