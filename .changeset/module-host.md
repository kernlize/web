---
'@kernlize/core': minor
---

A module host: `createKernl({ host, modules })` composes the shell from `KernlModule`s, checked before anything is built and disposed last loaded first, with each module's api typed as `kernl[id]`. The `theme` and `common` domains are now the theme and social modules; `kernlModules()` is what a shell loads when it names none, so existing callers are unchanged. A shell without the theme module does not offer `theme` and leaves it out of the baseline. `createCommonActions` also takes a consented `sign`, and `loadReplaceableQuietly` is exported.
