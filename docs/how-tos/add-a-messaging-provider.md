# Add a messaging provider

A provider is a package change plus a docs page. This how-to adds a provider called `example` and wires it into the shell's registry.

## 1. Describe it truthfully

Start with the properties, because they are the contract with the user. Every field except `specification` is required, and the shell shows all of them except `specification` through `describeProvider`.

```ts
import type { ProviderDefinition, SecurityProperties } from '@kernl/messaging';

export const EXAMPLE_PROPERTIES: SecurityProperties = {
  forwardSecrecy: false,
  postCompromiseSecurity: false,
  metadataProtection: 'partial',
  requiresSameClient: true,
  groups: false,
  specification: 'https://example.org/spec',
  experimental: true,
};

export const EXAMPLE_DEFINITION: ProviderDefinition = {
  id: 'example',
  name: 'Example messages',
  description: 'Messages readable by other people using this shell.',
  properties: EXAMPLE_PROPERTIES,
};
```

If you are unsure whether a property holds, it does not. A provider that overstates its protection fails the review, however good its code is. `name` and `description` are shown in the public UI, so they follow the [public vocabulary](../policies/public-vocabulary.md): no protocol names. `specification` is where the protocol name goes; `describeProvider` never renders it.

## 2. Implement the backend

A `MessagingBackend` has six methods and an optional `close`. Ids you return are provider-local; the composite prefixes them with `example:`. Wire types come from `@napplet/core`. The backend talks to whatever the shell hands it; here that is a small `ExampleDeps` object so the sample stays free of any relay library. The samples on this page are one module, read top to bottom.

<!-- sample:continues -->
```ts
import type { DmMessage, DmSendRequest, DmSendResult } from '@napplet/core';
import type { MessagingBackend } from '@kernl/messaging';

export interface ExampleDeps {
  readonly ownerPubkey: string;
  readonly publish: (request: DmSendRequest) => Promise<DmMessage>;
  readonly history: (conversationId: string) => readonly DmMessage[];
  readonly onIncoming: (listener: (message: DmMessage) => void) => () => void;
}

export function createExampleBackend(deps: ExampleDeps): MessagingBackend {
  const subscriptions = new Map<string, () => void>();
  let count = 0;
  return {
    status: () => ({ available: true, ownerPubkey: deps.ownerPubkey, implementations: ['example'], capabilities: ['send', 'receive', 'subscribe', 'history'] }),
    conversations: () => ({ conversations: [] }),
    messages: (query) => ({ messages: [...deps.history(query.conversationId)] }),
    async send(request): Promise<DmSendResult> {
      if (request.recipients.length === 0) throw new Error('invalid:no-recipients');
      return { ok: true, message: await deps.publish(request) };
    },
    subscribe(request, onMessage) {
      count += 1;
      const subscriptionId = `example-${count}`;
      subscriptions.set(
        subscriptionId,
        deps.onIncoming((message) => {
          if (request.conversationId === undefined || message.conversationId === request.conversationId) onMessage(message);
        }),
      );
      return { subscriptionId };
    },
    unsubscribe(subscriptionId) {
      const stop = subscriptions.get(subscriptionId);
      stop?.();
      return { ok: subscriptions.delete(subscriptionId) };
    },
    close() {
      for (const stop of subscriptions.values()) stop();
      subscriptions.clear();
    },
  };
}
```

Rules the backend must keep:

- Use the shell's shared `EventStore` and `RelayPool` (`kernl.eventStore`, `kernl.pool`); do not open a second relay connection. The shell does not inject anything into your backend: `@kernl/core` calls only the factory you register, so you build `ExampleDeps` yourself from those instances, as `exampleDeps(resolve)` below does.
- Sign only through the active account's signer (`kernl.accounts.active?.signer`), wrapped in a function you put in `ExampleDeps` such as `publish`. Never touch key bytes.
- Reject with stable reasons: `denied:`, `invalid:`, `unavailable:`.
- `subscribe` returns `{ subscriptionId }`; `unsubscribe` of an unknown id returns `{ ok: false }`; `close` drops every subscription. Every method except `send` may be synchronous.
- Page with `cursor` and `limit`. The composite passes your cursor through when you are the only enabled provider, so make it a string you can resume from.

Use `createMemoryBackend` as the reference for the semantics the features expect, and as the backend in your own tests.

## 3. Build the provider with `defineProvider`

The registry calls `createBackend()` once per enable and `available()` whenever it needs to know. Both are injected, so this package never learns what a session is:

<!-- sample:continues -->
```ts
import { defineProvider, type ProviderDeps } from '@kernl/messaging';

export function exampleDeps(resolve: () => ExampleDeps | undefined): ProviderDeps {
  return {
    createBackend: () => {
      const deps = resolve();
      if (!deps) throw new Error('unavailable:signed-out');
      return createExampleBackend(deps);
    },
    available: () => (resolve() ? { available: true } : { available: false, reason: 'signed-out' }),
  };
}

// Set by your sign-in code when a session starts, cleared on sign-out.
let sessionDeps: ExampleDeps | undefined;

export const provider = defineProvider(EXAMPLE_DEFINITION, exampleDeps(() => sessionDeps));
```

The `reason` is a bare word. The registry prefixes it: `enable('example')` throws `unavailable:signed-out`, and `list()` reports `{ available: false, reason: 'signed-out' }` so the picker can grey the provider and say why.

The three built-ins (`createPrivateMessagesProvider`, `createLegacyMessagesProvider`, `createRatchetMessagesProvider`) are exactly this shape: a fixed definition in the package, `ProviderDeps` from the shell. If your provider ships in `@kernl/messaging`, add `createExampleMessagesProvider(deps: ProviderDeps)` next to them in `packages/messaging/src/providers/` and export it from `providers/index.ts`.

## 4. Register it

The three built-in providers are registered by `createDefaultMessaging` in `packages/core/src/messaging/default-registry.ts`, which `createKernl` calls when `KernlOptions.messaging` is absent. You do not edit `createKernl`. A host has two options-based paths:

- **A backend for a built-in provider.** Pass `KernlOptions.messagingBackends`, a `MessagingBackendFactories` (`{ private?, legacy?, ratchet? }`, each `() => MessagingBackend`). Your factory replaces kernl's backend for that provider (`createPrivateMessagesBackend` or `createLegacyMessagesBackend` by default); availability still follows the active account's signer.
- **A new provider.** Build the default registry yourself, register yours on it, and pass it as `KernlOptions.messaging`. The defaults stay registered:

<!-- sample:continues -->
```ts
import { createDefaultMessaging, createKernl, type KernlHost } from '@kernl/core';

declare const host: KernlHost;

const messaging = createDefaultMessaging({ storage: host.storage });
messaging.register(provider);
const kernl = createKernl({ host, messaging });
```

When `messaging` is supplied, `createKernl` uses it as is and ignores `messagingBackends`; pass any built-in backends to `createDefaultMessaging({ storage, backends })` instead. To ship a provider inside kernl itself, register it in `createDefaultMessaging` next to the three built-ins.

Registration does not enable, unless the user's saved preferences already list `example`; then it is enabled on registration if `available()` agrees, and left disabled otherwise. The user enables it in the provider picker, which calls `registry.enable('example')`. Registering the same id twice throws `invalid:duplicate-provider`. See `registry.feature`, scenarios "a registered provider starts disabled" and "saved preferences enable providers as they register".

## 5. Specify and document

- Add the provider to the `Scenario Outline` in `packages/messaging/features/providers.feature` ("the built-in providers carry fixed copy and properties") with its name, description, six properties and specification, and a scenario that `describeProvider` rows name no protocol. Step definitions live in `packages/messaging/features/steps/`.
- If the backend lives in a package, give it a feature file modelled on `memory-backend.feature`: sends create conversations, delivered messages are unread, subscriptions filter by conversation, cursors resume.
- Add a row to the providers table in [Messaging](../concepts/messaging.md#the-three-providers) and a line to the providers table on the [package page](../packages/messaging.md#providers).
- Add a changeset for `@kernl/messaging` (and `@kernl/core` if you touched `createDefaultMessaging`).

`pnpm test` must stay at 100% coverage over `packages/*/src`, and `pnpm docs:check` must pass. A provider without the feature rows or the docs rows is not shipped.
