# Kernel, modules and presets

kernl is a kernel, a set of modules, and presets that put the two together ([D-061](../decisions.md#d-061), [D-068](../decisions.md#d-068)). The kernel is what protects the person, and no host can turn it off. A module is one of kernl's opinions, which a host loads, leaves out or replaces. A preset is a module list someone chose: kernl.run runs `kernlPreset`, and your page runs whichever modules you name.

| Package | What it is |
| --- | --- |
| [`@kernlize/kernel`](../packages/kernel.md) | The floor. Every host has all of it. |
| [`@kernlize/modules`](../packages/modules.md) | kernl's modules, one entry per module, so a bundler reads only the ones you import. |
| [`@kernlize/preset`](../packages/preset.md) | `kernlPreset`, kernl.run's list; `createKernl`, which loads it when you name no modules; and `previewPreset`, the same shell over parts that live in the page. |

There are two ways in. **Run kernl**: deploy kernl.run's shell, which is the kernel under `kernlPreset` ([Run the shell](../tutorials/run-the-shell.md)). **Build on its kernel**: write your own page, with your own UX, over `@kernlize/kernel` and the modules you want ([Build a shell with your own UX](../tutorials/build-a-shell.md)).

## The floor

Everything here is in `@kernlize/kernel`. No host option and no module weakens it, because each item is what stands between an applet and the person.

| Floor | Why it cannot be optional |
| --- | --- |
| **The sandbox.** Applets load as `srcdoc` in a frame with `sandbox="allow-scripts"` and the guard's CSP, never in a nested frame, and the page's frame policy stops any frame loading a URL ([D-014](../decisions.md#d-014)). | An applet is someone else's code. Without the sandbox it could read the page, the person's keys in the page's storage, and every other applet. |
| **The mount order.** Register, set the environment, observe the frame, and only then assign `srcdoc`; the frame goes on every revocation. | Out of order, an applet's first message could arrive before the kernel knows which applet it is, or a revoked one could keep running. |
| **Identity by artifact hash.** Grants belong to the exact bytes, and changed bytes start with none. | Otherwise a publisher could ship new code under grants the person gave to old code. |
| **The restrictive ACL.** An applet holds only what the person's grants wrote ([D-020](../decisions.md#d-020)). | What an applet says it needs is advisory. Only the person grants. |
| **Keys inside signers.** Keys live in applesauce signers, never in storage in the clear, and the kernel refuses an account that would persist one. | A key in storage is a key any script on the origin can read. |
| **Consent before a destructive write.** A write that replaces or erases the person's record (profile, follows, relay lists, a deletion, a request to vanish) is put to them first, whether an applet or a module asked. | Those writes cannot be taken back once relays have them. |
| **The guard.** Every message from an applet passes the guard before kehto sees it: rate limits, the hidden allowance, quarantine ([Guard](./guard.md)). | A flood or a hidden applet working in the background is how an applet abuses the person's network and battery. A profile can loosen limits, never remove the guard. |
| **The firewall's admission.** kehto's firewall admits every domain an applet holds in `plan`, before its code runs, and a window the kernel did not plan is never served ([D-056](../decisions.md#d-056)). | A grant that arrived after the code started could not be refused in time. |
| **The seal on messages.** An applet that reads private messages holds only the domains that cannot carry them anywhere. The list is in the kernel, and a module cannot add to it ([D-046](../decisions.md#d-046), [D-060](../decisions.md#d-060)). | Otherwise any domain a module adds would be a way to send someone's messages out. Only the person may keep one beside messages. |
| **Secrets kept out of logs.** Passwords and keys of the services the shell signs in to never appear in logs, guard events, traffic or consent summaries ([D-052](../decisions.md#d-052)). | Those views exist to be shown and shared. |
| **One store, one pool, one account manager.** | Two of any of them would mean two views of the person's identity and data that could disagree. |

The kernel also answers the domains every applet relies on: `shell`, `storage`, `inc`, `relay`, `identity`, `notify`, `link`, `outbox`, `resource` and `media` (`KERNEL_DOMAINS`). A module that answers one of them is refused, and the shell is not built.

Some things inside the floor are tunable within limits: the guard's starting profile changes its limits only, the firewall's rules decide what is asked about, and the secrets provider decides where secrets are kept. None of them moves a guarantee in the table.

## Modules

A module has an id and a `setup` that the kernel calls once, when the shell is composed. It returns what it brings:

| Part | What it is |
| --- | --- |
| `services` | The NAP domains it answers. An applet is offered a domain only when some module answers it. |
| `extensions` | Domains kehto's prelude has to be told about. They are offered only where the installed kehto renders them. |
| `api` | What the host reaches as `kernl[id]`, typed from the module list. |
| `dispose` | What closes it. Modules close in the reverse of the order they were loaded. |

A module may name `requires`, the ids that must be loaded before it, and `asks`, the kinds of question it may put to the person. The kernel refuses a list that repeats an id, uses one of the kernel's own names, leaves a requirement unmet or lists it too late, before it builds anything.

### What a module is handed

`setup` receives the kernel's context: the shell's one event store, one relay pool and its relay tiers, the host's storage, who is signed in and whether they can sign, which applet a window runs, the shell's replaceable loader, `use(id)` for the api of a module loaded before it, `find(id)` for one that may not be loaded, and `ask` for a question of a kind the module declared, which the host draws ([Asks](./asks.md)).

It is not handed kehto's bridge. A write an applet asked for is signed through `sign(windowId, template)`, which puts one that replaces or erases the person's record to them first, the same gate an applet's own write meets. A write the host started for the person, such as saving their relays from settings, is signed with `signer()`, the active identity's signer ([D-065](../decisions.md#d-065)). A module is trusted as the host that loads it is; its applets' messages pass the guard and the firewall like every other.

### What a module cannot do

- **Replace the kernel's answer to a domain.** A module that answers a domain in `KERNEL_DOMAINS` is refused.
- **Arrive late.** Modules are fixed when the shell is composed, because the firewall admits every domain an applet holds before its code runs.
- **Reach an applet that reads messages.** A domain a module adds is withheld from such an applet unless the person keeps it.
- **Invent protocol.** A module adds only domains on the napplet track. The kernel does not check this; it is the rule for whoever writes one.

### What leaving one out does

A domain no loaded module answers is never offered. An applet that requires it plans with it missing, and the store hides an applet the shell cannot fully run until asked ([D-059](../decisions.md#d-059)).

| Module | Without it |
| --- | --- |
| `theme` | `theme` is not offered and leaves every applet's baseline. |
| `keys` | `keys` is not offered and leaves the baseline. |
| `profiles`, `people` | Conversations and recipients are shown by key, not by name. |
| `social` | `common` is not offered. |
| `messaging` | `dm` is not offered. |
| `directory` | An account with no relay list is offered the well-known servers. |
| `mailboxes` | The person's published inboxes and outboxes are not read; the `outbox` tier stays as the host and the person set it. |
| `files` | `upload` is not offered. |
| `settings` | `config` is not offered. |
| `catalog` | There is no store; applets open from their addresses or as builtins. |
| `intents` | Applets cannot hand each other work, and nothing is installed. |
| `bridges` | `resource` is not offered: the shell fetches nothing for applets, though the kernel answers the domain when the module is loaded. |
| `downloads` | Applets cannot work through the person's download programs. |
| `multiplayer` | No remote tools, no direct connections. |
| `cache` | Events are kept in memory only. |

Two ids are known to the kernel: `directory` and `cache`. It reads the first for suggested relays and asks the second before any relay, so a module a host puts in their place has the same api as `directoryModule` and `cacheModule`.

Where a module has parts with heavy libraries, each part is its own import. The messaging module takes `privateDm()`, `legacyDm()`, `ratchet()` and `groups()`, and a shell that lists only the first bundles neither the ratchet nor the group library.

## Presets

A preset is a module list with its options. `kernlPreset(options)` from `@kernlize/preset` is kernl.run's: theme, profiles, people, social, messaging, directory, mailboxes, files, settings, catalog, keys, intents, bridges, downloads, multiplayer and cache, in that order, typed so the shell gets each module's api. `createKernl({ host })` with no module list loads it, so a host that names none gets kernl.run's shell.

`previewPreset` is the same kernel and modules over parts that live in the page: relays in memory, sample applets signed at build time, scripted correspondents. kernl.run's preview runs it, so the preview and the live shell are one implementation.

Your own preset is just your own list:

```ts
import { createKernel, type KernlHost } from '@kernlize/kernel';
import { messagingModule, privateDm } from '@kernlize/modules/messaging';
import { filesModule } from '@kernlize/modules/uploads';

declare const host: KernlHost;

const kernl = createKernel({ host, modules: [messagingModule({ providers: [privateDm()] }), filesModule()] });
kernl.messaging.list(); // the providers the person can choose among
kernl.files.current(); // the person's file servers
```

## The rules between the packages

`scripts/check-dependency-rules.mjs` holds the layering to account on every build:

- The kernel imports no module and no preset.
- A module imports the kernel and takes values only from the modules it `requires`. Types are free.
- Nothing published imports the preset, except `@kernlize/core`, which re-exports it for one minor and then goes.

So a host that imports `@kernlize/kernel` and two module entries bundles the kernel and those two modules, and nothing else of kernl's.

## What each costs

What a browser downloads for three hosts, each bundled for the browser and minified from the built packages, with every library they import. `node scripts/bundle-sizes.mjs` writes this table, and `pnpm docs:check` fails when it is out of date.

<!-- bundle-sizes:start -->
| Host | What it composes | Minified | Gzipped |
| --- | --- | ---: | ---: |
| The kernel alone | `createKernel` with no modules | 596.3 KB | 193.7 KB |
| The example host | the kernel, messaging with `privateDm()`, and files, as `examples/minimal-host` composes them | 673.9 KB | 218.3 KB |
| kernl's preset | `createKernl`, which loads all sixteen of kernl.run's modules | 1782.0 KB | 550.5 KB |
<!-- bundle-sizes:end -->

## Related

- [Build a shell with your own UX](../tutorials/build-a-shell.md)
- [Architecture](./architecture.md)
- [Asks](./asks.md)
- [Applets under kernl](./applets-under-kernl.md)
