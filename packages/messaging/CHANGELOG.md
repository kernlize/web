# @kernlize/messaging

## 0.4.1

### Patch Changes

- 4fa61e5: Move to `@kehto/shell` 0.35, `@kehto/services` 0.34, `@kehto/runtime` 0.30, `@kehto/acl` 0.20.6, `@napplet/core` 0.41, `@napplet/nap` 0.40 and applesauce 7.1 (D-037).

  - **core:** `createRuntimeFirewallHooks` now constructs the runtime firewall from `@kehto/rate-limit/legacy` and returns it as `legacyFirewall` in place of `firewallPersistence`, because the runtime no longer builds one. The stored configuration under `kernl:firewall:v1` keeps its format. New `createAppletRelayService` plans relay publishes by event kind for kehto's planned relay contract. Signers are kept stable per account and window so the identity and relay services deliver their replies. Intents are delivered through the runtime's recipient gate. The shell's pool is built with the new `SHELL_RELAY_OPTIONS`, one redial after a second for publishes and requests, because applesauce-relay 7.1 otherwise holds a publish to a dead relay for about six seconds. A manifest lookup lets applesauce-relay redial a refused relay once instead of repeating the round. The `@napplet/core` peer range is now `>=0.41.0 <0.42.0` and `@napplet/nap` `>=0.37.0 <0.41.0`.
  - **guard:** the temporal engine moved from `@kehto/firewall` to `@kehto/rate-limit/legacy`; the guard depends on `@kehto/rate-limit` and its `GuardConfig.firewall` and `FocusFirewall.observe` types come from there. The `@napplet/core` peer range widens to `<0.42.0`.
  - **messaging:** the `@napplet/core` peer range widens to `<0.42.0`.

## 0.4.0

### Minor Changes

- ed91035: Messages become an applet, and the user orders the providers.

  `@kernlize/messaging`: the registry keeps providers in the user's order (`setOrder`, `list()` in order) and the first enabled one is the default; a send to someone new falls to the next enabled provider when the first cannot reach them. Before a one-to-one message leaves through a provider other than the one its recipient last wrote through, the reply rule decides: `ask` puts a `ReplyPrompt` to the new `askReply` option, `theirs` follows the correspondent, `mine` keeps the order (`setReplyRule`, `forgetReplyChoice`, `CompositeOptions.chooseReply`). A saved provider that cannot run yet now waits and starts when it can. Breaking: `MessagingPreferences` gains required `order`, `reply` and `replyChoices`, `defaultProvider` is derived from the order, and `MessagingRegistryOptions.preferences` takes `SavedMessagingPreferences`.

  `@kernlize/core`: `KernlOptions.builtins` lists applets the host ships; `kernl:<id>` decodes to a `builtin` pointer and resolves from bytes pinned by SHA-256, with no manifest lookup (`resolveBuiltin`, `builtinAddress`, `BUILTIN_PUBLISHER`, `BuiltinApplet`, `PublishedPointer`, `AppletSummary.builtin`, reason `invalid:artifact-hash`). `KernlHost.chooseReply` carries the reply question to the user. `createDefaultMessaging` switches `private` and `legacy` on for someone who has never chosen. Breaking: `AppletPointer` has a third kind, and `fetchManifestEvent` takes a `PublishedPointer`.

## 0.3.0

### Minor Changes

- 5726a3d: Publish npm packages under `@kernlize/*` and the same releases on JSR under `@kernl/*`. Update internal imports and the exported `PACKAGE_NAME` constants to the npm names. Generate JSR sources and dependency maps from the workspace and installed lockfile versions.

### Patch Changes

- 9b824bb: Accept `@napplet/core` 0.38 as a peer.

## 0.2.0

### Minor Changes

- c9cb0a7: Add the `group` messaging provider: group sessions (Marmot, MLS over nostr) over `@internet-privacy/marmot-ts`, with the account signer for identity and invitations and every library store sealed to the account. `@kernlize/messaging` exports `createGroupMessagesProvider`; `@kernlize/core` exports `createGroupMessagesBackend`, `createSealedGroupStore` and `createGroupNetwork`, and `createKernl` wires the provider.
