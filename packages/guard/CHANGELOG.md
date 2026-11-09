# @kernlize/guard

## 0.1.1

### Patch Changes

- 5726a3d: Publish npm packages under `@kernlize/*` and the same releases on JSR under `@kernl/*`. Update internal imports and the exported `PACKAGE_NAME` constants to the npm names. Generate JSR sources and dependency maps from the workspace and installed lockfile versions.
- 9b824bb: Depend on `@kehto/firewall` ^0.7.0 and accept `@napplet/core` 0.38. The `hidden-deferral` mitigation now says a hidden applet's requests are held until it is visible, and `focus-tightening` is provided by both kehto and kernl, because the runtime firewall applies the unfocused multiplier too (D-020).
