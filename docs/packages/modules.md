# @kernlize/modules

kernl's modules over the kernel ([D-068](../decisions.md#d-068)). Each opinion is a module a host names: messaging and its providers, bridges, downloads, uploads, the applet catalog, stacks, controller input, intents, multiplayer, people, profiles, mailboxes, the relay directory, the event cache, the theme, settings, social actions, keys and the window manager. A module imports the kernel and other modules, never `@kernlize/core` or kernl's preset; `pnpm check:deps` enforces that.

| Field | Value |
| --- | --- |
| npm | `@kernlize/modules` |
| JSR | `@kernl/modules` |
| Version | `0.3.0` |
| Entry | `./dist/index.js`, types `./dist/index.d.ts`; one entry per module (`./bridges`, `./cache`, `./catalog`, `./directory`, `./downloads`, `./gamepad`, `./intents`, `./keys`, `./mailboxes`, `./messaging`, `./messaging/groups`, `./messaging/ratchet`, `./multiplayer`, `./people`, `./profiles`, `./settings`, `./social`, `./stacks`, `./theme`, `./uploads`, `./wm`) |
| Dependencies | `@kernlize/kernel` and the three leaf packages (`workspace:^`), `@kehto/*`, `applesauce-*`, `@internet-privacy/marmot-ts`, `nostr-double-ratchet`, `@sqlite.org/sqlite-wasm`, `blossom-client-sdk`, `rxjs` |
| Peer dependencies | `@napplet/core`, `@napplet/nap`, `@napplet/shim`, `nostr-tools` |
| Side effects | none |

## Install

This package is `@kernlize/modules` on npm and `@kernl/modules` on JSR, the same code at the same version.

```sh
npm install @kernlize/kernel @kernlize/modules
# or
deno add jsr:@kernl/kernel jsr:@kernl/modules
```

## Compose the modules a host wants

```ts
import { createKernel, type KernlHost } from '@kernlize/kernel';
import { messagingModule, privateDm, themeModule } from '@kernlize/modules';

declare const host: KernlHost;
const kernl = createKernel({ host, modules: [themeModule(), messagingModule({ providers: [privateDm()] })] });
kernl.messaging.list().map((entry) => entry.provider.id); // ['private']
```

Each module also has an entry of its own: `@kernlize/modules/theme`, `@kernlize/modules/messaging`, `@kernlize/modules/uploads` (the files module) and so on. A host that imports from the root ends up with the same bundle after tree shaking. Importing from a module's entry means the bundler reads only that module: for the theme module, 568 bytes of this package instead of 279 KB. `features/bundling.feature` checks this.

The ratchet and group providers are their own entries, `@kernlize/modules/messaging/ratchet` and `@kernlize/modules/messaging/groups`. Their libraries reach a bundle only when a host lists them; `features/bundling.feature` checks this. The window manager (`./wm`) and the event cache (`./cache`) also load on their own, without the network stack.

`@kernlize/core` re-exports this package and its entries.

## Stacks and controller input

- [`@kernlize/modules/stacks`](../concepts/store-and-intents.md#stacks) provides `stacksModule()` and read-only `loadStacks` and `streamStacks` helpers. The module uses the kernel’s shared store and reads through the cache module when present.
- `@kernlize/modules/gamepad` provides `gamepadModule(settings?)` and `createControllerService`. Only the granted, focused applet receives live controller readings; omit the module or set `offer: false` to disable it.

[API reference](../api/modules/_kernlize_modules.html){target="_self"}
