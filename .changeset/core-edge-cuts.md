---
'@kernlize/core': minor
---

Groundwork for the package split (#75); every public name keeps its export.

- The ask facts (`DownloadQuestion`, `DownloadQuestionLine`, `UploadDetails`) live with the ask contract.
- The domain binding types, `supportsDomainBindings` and the new `bindingMethod` live with the applet lifecycle.
- The guard's key handling lives in the guard, and `ShortcutKey` with the host contract.
- `createKernlServices` no longer builds a `keys` service; the keys module answers `keys`. `KernlServiceDeps` loses `keys`, its `shortcuts` is now only `{ isFocused }`, and `KernlServices` loses `keys`.
- `createKernlServices` no longer wires `cvm`; the multiplayer module answers it. `KernlServiceDeps` loses `remoteTools` and `identities`.
