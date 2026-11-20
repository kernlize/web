---
"@kernlize/core": minor
"@kernlize/guard": patch
---

Keyboard shortcuts work for every applet. `keys` is now a baseline domain served by `createShortcutsService`: an applet gets the key it asks for, is told its bindings, and has its action run in the focused window. A keymap registered as an applet starts is held through the startup window instead of being refused, a held key's repeats no longer count as a flood, and the guard classifies `keys.*` as `control`. `createKernlServices` requires `shortcuts`, `KernlOptions.shortcuts` reserves the host's own chords, and `KernlHost.onShortcut` receives the keys an applet forwards.
