# @kernlize/guard

## 0.2.0

### Minor Changes

- 4fa61e5: Move to `@kehto/shell` 0.35, `@kehto/services` 0.34, `@kehto/runtime` 0.30, `@kehto/acl` 0.20.6, `@napplet/core` 0.41, `@napplet/nap` 0.40 and applesauce 7.1 (D-037).

  - **core:** `createRuntimeFirewallHooks` now constructs the runtime firewall from `@kehto/rate-limit/legacy` and returns it as `legacyFirewall` in place of `firewallPersistence`, because the runtime no longer builds one. The stored configuration under `kernl:firewall:v1` keeps its format. New `createAppletRelayService` plans relay publishes by event kind for kehto's planned relay contract. Signers are kept stable per account and window so the identity and relay services deliver their replies. Intents are delivered through the runtime's recipient gate. The shell's pool is built with the new `SHELL_RELAY_OPTIONS`, one redial after a second for publishes and requests, because applesauce-relay 7.1 otherwise holds a publish to a dead relay for about six seconds. A manifest lookup lets applesauce-relay redial a refused relay once instead of repeating the round. The `@napplet/core` peer range is now `>=0.41.0 <0.42.0` and `@napplet/nap` `>=0.37.0 <0.41.0`.
  - **guard:** the temporal engine moved from `@kehto/firewall` to `@kehto/rate-limit/legacy`; the guard depends on `@kehto/rate-limit` and its `GuardConfig.firewall` and `FocusFirewall.observe` types come from there. The `@napplet/core` peer range widens to `<0.42.0`.
  - **messaging:** the `@napplet/core` peer range widens to `<0.42.0`.

## 0.1.1

### Patch Changes

- 5726a3d: Publish npm packages under `@kernlize/*` and the same releases on JSR under `@kernl/*`. Update internal imports and the exported `PACKAGE_NAME` constants to the npm names. Generate JSR sources and dependency maps from the workspace and installed lockfile versions.
- 9b824bb: Depend on `@kehto/firewall` ^0.7.0 and accept `@napplet/core` 0.38. The `hidden-deferral` mitigation now says a hidden applet's requests are held until it is visible, and `focus-tightening` is provided by both kehto and kernl, because the runtime firewall applies the unfocused multiplier too (D-020).
