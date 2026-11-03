# Add a messaging provider

A provider is a package change plus a docs page. This how-to adds a provider called `example` and wires it into the shell's registry.

## 1. Describe it truthfully

Start with the properties, because they are the contract with the user. Every field is required and the shell shows all of them.

```ts
import type { SecurityProperties } from '@kernl/messaging';

export const EXAMPLE_PROPERTIES: SecurityProperties = {
  forwardSecrecy: false,
  postCompromiseSecurity: false,
  metadataProtection: 'partial',
  requiresSameClient: true,
  groups: false,
  specification: 'https://example.org/spec',
  experimental: true,
};
```

If you are unsure whether a property holds, it does not. A provider that overstates its protection fails the review, however good its code is.

## 2. Implement the backend

A `MessagingBackend` has six methods and an optional `close`. Ids you return are provider-local; the composite prefixes them. Timestamps and types come from `@napplet/core`.

```ts
import type { MessagingBackend } from '@kernl/messaging';
import type { EventStore } from 'applesauce-core';
import type { RelayPool } from 'applesauce-relay';

export interface ExampleDeps {
  store: EventStore;
  pool: RelayPool;
  ownerPubkey: string;
  sign: (template: EventTemplate) => Promise<NostrEvent>;
}

export function createExampleBackend(deps: ExampleDeps): MessagingBackend {
  return {
    status: () => ({ available: true, ownerPubkey: deps.ownerPubkey, implementations: ['example'], capabilities: ['send', 'subscribe'] }),
    conversations: async (query) => { /* read from deps.store */ },
    messages: async (query) => { /* read from deps.store, page by query.cursor */ },
    send: async (request) => { /* build, sign through deps.sign, publish through deps.pool */ },
    subscribe: async (request, onMessage) => { /* subscribe on deps.store, return { subscriptionId } */ },
    unsubscribe: async (subscriptionId) => ({ ok: true }),
    close: () => { /* drop subscriptions */ },
  };
}
```

Rules the backend must keep:

- Read from the shared `EventStore`; do not open a second relay connection outside the shared `RelayPool`.
- Sign only through the function the shell injects. Never touch key bytes.
- Reject with stable reasons: `denied:`, `invalid:`, `unavailable:`.
- Return `{ close() }`-style handles for anything long-lived.

## 3. Implement the provider

```ts
import type { MessagingProvider } from '@kernl/messaging';

export function createExampleProvider(deps: () => ExampleDeps | undefined): MessagingProvider {
  return {
    id: 'example',
    name: 'Example messages',
    description: 'Messages readable by other people using this shell.',
    properties: EXAMPLE_PROPERTIES,
    availability: () => (deps() ? { available: true } : { available: false, reason: 'unavailable:example-runtime' }),
    createBackend: () => createExampleBackend(deps()!),
  };
}
```

`name` and `description` are shown in the public UI, so they follow the [public vocabulary](../policies/public-vocabulary.md): no protocol names. `specification` is where the protocol name goes.

## 4. Register it

In `@kernl/core`, `createKernl` builds the registry. Add the provider where the three existing ones are registered:

```ts
registry.register(createExampleProvider(() => exampleDeps));
```

Registration does not enable. The user enables it in the provider picker, which calls `registry.enable('example')`; `availability()` is checked there and an `unavailable:` reason is shown if it fails.

## 5. Specify and document

- Add `packages/messaging/features/providers/example.feature` with scenarios for: properties are reported verbatim; ids are namespaced `example:<innerId>`; sending without a conversation and with `provider: 'example'` routes here; disabling closes the backend. Step definitions go in `features/steps/`.
- Add a row to the providers table in [Messaging](../concepts/messaging.md) and a line to `packages/messaging` on the [package page](../packages/messaging.md).
- Add a changeset for `@kernl/messaging` (and `@kernl/core` if you touched registration).

`pnpm test` must stay at 100% coverage over `packages/*/src`, and `pnpm docs:check` must pass. A provider without the feature file or the docs row is not shipped.
