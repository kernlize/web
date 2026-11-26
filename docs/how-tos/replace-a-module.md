# Replace a module

Every module in kernl's preset can be left out or replaced by one of yours; the kernel cannot ([Kernel, modules and presets](../concepts/kernel-modules-and-presets.md)). This page does both to kernl.run's list: leaves the multiplayer module out, and puts a theme of your own in place of kernl's. The samples are one module, type-checked by `pnpm docs:check`.

## 1. Start from kernl's list, or from none

`kernlPreset(options)` from `@kernlize/preset` returns kernl.run's eighteen modules, in order. Keep the order when you change the list: a module comes after the ones it `requires`.

```ts
import { createKernel, type KernlHost, type KernlModule } from '@kernlize/kernel';
import { kernlPreset } from '@kernlize/preset';

declare const host: KernlHost;

const kept = kernlPreset().filter((module) => module.id !== 'multiplayer');
```

A host that wants only a few of kernl's modules does not start from the preset at all: it imports those modules' entries from `@kernlize/modules`, so the bundler never reads the rest ([Build a shell with your own UX](../tutorials/build-a-shell.md)). Filtering the preset leaves the others in your bundle.

## 2. Leave one out

What a module answered is no longer offered: without multiplayer, no applet is offered `cvm` or `webrtc`, and the store hides an applet that requires them until asked ([D-059](../decisions.md#d-059)). A module that `requires` the one you removed makes the kernel refuse the list with `invalid:module-missing:<id>`, so remove it too, or replace what it needs.

## 3. Put your own in its place

A replacement takes the same id. Here is a theme that follows the person's light or dark preference, where kernl's sends one palette and leaves changing it to the host:

<!-- sample:continues -->
```ts
import { createThemeService } from '@kehto/services';
import type { Theme } from '@napplet/nap/theme/types';

const LIGHT: Theme = { colors: { background: '#f5f1e8', text: '#15171b', primary: '#9a5b00' } };
const DARK: Theme = { colors: { background: '#15171b', text: '#f5f1e8', primary: '#e0a040' } };

export function followingTheme(media: MediaQueryList): KernlModule<'theme', { current(): Theme }> {
  return {
    id: 'theme',
    setup() {
      const pick = (): Theme => (media.matches ? DARK : LIGHT);
      const service = createThemeService({ initialTheme: pick() });
      const follow = (): void => void service.publishTheme(pick());
      media.addEventListener('change', follow);
      return {
        services: { theme: service.handler },
        api: { current: pick },
        dispose: () => media.removeEventListener('change', follow),
      };
    },
  };
}

const modules = [...kept.filter((module) => module.id !== 'theme'), followingTheme(matchMedia('(prefers-color-scheme: dark)'))];
const kernl = createKernel({ host, modules });
```

It answers `theme` as kernl's did, so applets are offered `theme` exactly as before, and its api is yours. Because the list is no longer the preset's own tuple, `kernl` is typed as the kernel plus whatever the list's types say; give the list a type of its own, or reach a module's api with a cast, when you need it typed.

## 4. Two ids the kernel reads

The kernel itself reads two modules by id: `directory`, for the relays it suggests to someone with no relay list, and `cache`, which its replaceable loader and the store's catalogue ask before any relay. A replacement for either must have the same api as `directoryModule` or `cacheModule`. For the cache, you rarely need a module at all: give `cacheModule` an opener over your own storage ([Add a cache backend](./add-a-cache-backend.md)).

## 5. Check it

- `kernl.grants.availableDomains()` lists the domains the composed shell offers: `theme` is there, `cvm` and `webrtc` are not.
- Switch the system between light and dark with an applet open that holds `theme:read`: it is told the new colours.
- Put a module before one it `requires`, and `createKernel` throws `invalid:module-order:<id>` before building anything.

## Related

- [Write a module](./write-a-module.md)
- [Add a messaging provider](./add-a-messaging-provider.md), [Add a bridge backend](./add-a-bridge-backend.md) and [Add a cache backend](./add-a-cache-backend.md): replacing a part of a module through its options
- [`@kernlize/preset`](../packages/preset.md)
