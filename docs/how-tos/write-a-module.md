# Write a module

A module is one opinion of the shell, loaded into the kernel when the shell is composed ([Kernel, modules and presets](../concepts/kernel-modules-and-presets.md#modules)). This page writes one: `pins`, which keeps a list of applet addresses per identity and gives the host `kernl.pins`. The samples on this page are one module, read top to bottom, and are type-checked by `pnpm docs:check`.

## 1. Name it and type its api

A module is a `KernlModule<Id, Api>`. The id is what the host reaches it by, `kernl[id]`, and what other modules `requires`; it must not be one of the kernel's own names.

```ts
import { BehaviorSubject, type Observable } from 'rxjs';
import { createKernel, type KernelContext, type KernlHost, type KernlModule } from '@kernlize/kernel';

/** The applets the person pinned, per identity. */
export interface Pins {
  /** The pinned addresses of whoever is signed in, as they change. Empty while nobody is. */
  readonly list$: Observable<readonly string[]>;
  pin(address: string): void;
  unpin(address: string): void;
}
```

## 2. Write `setup`

`setup(context)` runs once, when the shell is composed, and returns what the module brings. Use the shell's own parts from the context; never open a second store, pool or account manager.

<!-- sample:continues -->
```ts
function createPins(context: KernelContext): Pins & { dispose(): void } {
  const list$ = new BehaviorSubject<readonly string[]>([]);
  // A module keeps its keys in the host's storage under `kernl:<module id>:`.
  const key = (pubkey: string): string => `kernl:pins:${pubkey}`;
  const read = (pubkey: string | undefined): readonly string[] => (pubkey ? JSON.parse(context.storage.getItem(key(pubkey)) ?? '[]') as string[] : []);
  const write = (next: readonly string[]): void => {
    const pubkey = context.identity.pubkey();
    if (!pubkey) throw new Error('denied:signed-out');
    context.storage.setItem(key(pubkey), JSON.stringify(next));
    list$.next(next);
  };
  const following = context.identity.pubkey$.subscribe((pubkey) => list$.next(read(pubkey)));
  return {
    list$,
    pin: (address) => write([...new Set([...list$.value, address])]),
    unpin: (address) => write(list$.value.filter((pinned) => pinned !== address)),
    dispose: () => {
      following.unsubscribe();
      list$.complete();
    },
  };
}

export function pinsModule(): KernlModule<'pins', Pins> {
  return {
    id: 'pins',
    setup(context) {
      const pins = createPins(context);
      return { api: pins, dispose: pins.dispose };
    },
  };
}
```

What `setup` may return:

| Part | When to return it |
| --- | --- |
| `api` | The host should reach the module. It appears as `kernl.pins`, typed from the module list. |
| `services` | The module answers a NAP domain, keyed by domain. An applet is offered the domain only because some module answers it. |
| `extensions` | The domain needs kehto's prelude to render bindings it does not build in, as the download domains do. |
| `dispose` | The module holds anything open. Modules close in the reverse of the order they were loaded. |

## 3. Compose it

<!-- sample:continues -->
```ts
declare const host: KernlHost;

const kernl = createKernel({ host, modules: [pinsModule()] });
kernl.pins.list$.subscribe((pinned) => console.info(`${pinned.length} pinned`));
```

**Check it.** Sign in, call `kernl.pins.pin('naddr1…')`, then sign in as someone else: the list is empty, and it comes back when the first identity signs in again.

## 4. Use another module

A module that needs another names it in `requires` and reaches its api with `context.use(id)`. The kernel sets modules up in order, so it refuses a list where the required module is missing (`invalid:module-missing`) or comes later (`invalid:module-order`), before it builds anything:

<!-- sample:continues -->
```ts
import type { Profiles } from '@kernlize/modules/profiles';

export function namesModule(): KernlModule<'names', { of(pubkey: string): string }> {
  return {
    id: 'names',
    requires: ['profiles'],
    setup(context) {
      const profiles = context.use<Profiles>('profiles');
      // The card's name falls back to the abbreviated key until a profile is found.
      return { api: { of: (pubkey) => profiles.card(pubkey).name } };
    },
  };
}
```

A module that can do without the other uses `context.find(id)` instead, which returns `undefined` when it is not loaded, and does not list it in `requires`. The messaging module does this with `people` and `profiles`. Importing another module's types is free; `scripts/check-dependency-rules.mjs` refuses a value import from a module you do not require.

## 5. Ask the person, sign, or answer a domain

- **Ask.** List the kinds of question in `asks`, then call `context.ask({ kind, windowId, applet, facts, defaultText })`. A kind you did not list rejects with `invalid:ask-undeclared:<kind>`. The host draws it, and without a renderer the answer is the kind's refusal ([Render an ask your own way](./render-an-ask.md)).
- **Sign.** A write an applet asked for goes through `context.sign(windowId, template)`, which puts one that replaces or erases the person's record to them first. A write the host started for the person uses `context.signer()` ([D-065](../decisions.md#d-065)).
- **Answer a domain.** Return `services: { [domain]: handler }`. The domain must be on the napplet track; a module never invents protocol. A domain the kernel answers is refused, and a domain you add is withheld from an applet that reads messages unless the person keeps it ([D-046](../decisions.md#d-046)). `themeModule` in `@kernlize/modules` is the shortest example: it answers `theme` with kehto's theme service.

## 6. Test it

Compose it in a test exactly as a host does, with a `KernlHost` whose `storage` is a `Map`, and assert on `kernl.pins`. kernl's own modules are specified this way in `packages/core/features/*.feature`, with a kernel booted offline over a fake relay pool; a module of yours gets the same: a feature file, and 100% coverage if it lives in `packages/`.

## Related

- [Replace a module](./replace-a-module.md)
- [Kernel, modules and presets](../concepts/kernel-modules-and-presets.md)
- [`@kernlize/kernel`](../packages/kernel.md)
