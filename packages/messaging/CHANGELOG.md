# @kernlize/messaging

## 0.2.0

### Minor Changes

- c9cb0a7: Add the `group` messaging provider: group sessions (Marmot, MLS over nostr) over `@internet-privacy/marmot-ts`, with the account signer for identity and invitations and every library store sealed to the account. `@kernlize/messaging` exports `createGroupMessagesProvider`; `@kernlize/core` exports `createGroupMessagesBackend`, `createSealedGroupStore` and `createGroupNetwork`, and `createKernl` wires the provider.
