# @kernlize/modules

## 0.2.0

### Minor Changes

- 5fc68c0: Each module has its own entry: `@kernlize/modules/messaging`, `@kernlize/modules/uploads`, `@kernlize/modules/profiles` and the rest, one per module. A host that imports a module from its entry makes the bundler read only that module, not every module kernl ships. The root entry still exports everything. A module now takes values only from the modules it `requires`; recipient lookup moved into messaging and the default relay suggestions are shared.
