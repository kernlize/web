# Modules

kernl is a kernel and a set of modules ([D-061](../decisions.md#d-061)). The kernel is what protects the person, and no host can turn it off: the sandbox, the mount order, grants tied to the exact code, the restrictive ACL, keys kept inside signers, consent before a write that replaces or erases their record, the guard, the firewall's admission and the seal on messages. Everything else is a module, an opinion a host can load, leave out or replace.

## What a module is

A module has an id and a `setup` that the kernel calls once, when the shell is composed. It returns what it brings:

| Part | What it is |
| --- | --- |
| `services` | The NAP domains it answers. An applet is offered a domain only when some module answers it. |
| `extensions` | Domains kehto's prelude has to be told about. They are offered only where the installed kehto renders them. |
| `api` | What the host reaches as `kernl[id]`, typed from the module list. |
| `dispose` | What closes it. Modules close in the reverse of the order they were loaded. |

A module may also name `requires`: ids that must be loaded before it, since modules are set up in order. The shell refuses a list that repeats an id, uses one of the kernel's own names, leaves a requirement unmet or lists it too late, before it builds anything.

## What a module is handed

`setup` receives the kernel's context: the shell's one event store, one relay pool and its relay tiers, the host's storage, who is signed in and whether they can sign, which applet a window runs, a way to load a replaceable event, and `use(id)` for another module's api or a part the kernel provides.

It is not handed a signer or kehto's bridge. A module signs through `sign(windowId, template)`, which puts a write that replaces or erases the person's record to them first, the same gate an applet's own write meets. Its applets' messages pass the guard and the firewall like every other.

## What a module cannot do

- **Replace the kernel's answer to a domain.** A module that answers `relay`, `storage` or any other domain the kernel answers (`KERNEL_DOMAINS`) is refused, and the shell is not built.
- **Arrive late.** Modules are fixed when the shell is composed, because the firewall admits every domain an applet holds before its code runs ([D-056](../decisions.md#d-056)).
- **Reach an applet that reads messages.** The domains that may go with messages are a list in the kernel. A domain a module adds is withheld from such an applet unless the person keeps it beside messages ([D-046](../decisions.md#d-046), [D-060](../decisions.md#d-060)).
A module adds only domains on the napplet track. The shell does not check this; it is the rule for whoever writes one, so no module invents protocol.

## What leaving one out does

A shell without the theme module does not offer `theme`, and `theme` leaves the baseline every applet starts with. An applet that requires it plans with it missing, and the store, which compares an applet's requirements with what the shell offers and starts applets with, hides it until asked, as it hides any applet this shell cannot fully run ([D-059](../decisions.md#d-059)). Without the social module, the `common` domain is not offered. Without the directory module the shell has no `kernl.directory`, and an account with no relay list is offered the well-known servers.

`createKernl({ host })` with no module list loads `kernlModules()`, kernl's own, so a host that names none gets the shell it always had. [The core package](../packages/core.md#modules) has the contract and an example.
