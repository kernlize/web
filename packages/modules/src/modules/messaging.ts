import type { IAccount } from 'applesauce-accounts';
import { ReadonlyAccount } from 'applesauce-accounts/accounts';
import type { ISigner } from 'applesauce-signers';
import { createDmService, type DmService } from '@kehto/services';
import type { MessagingRegistry, ReplyPrompt } from '@kernlize/messaging';
import { shellRelayOrigins, type KernelContext, type KernlModule } from '@kernlize/kernel';
import { messagingSigner } from '../messaging/availability.js';
import { createProviderMessaging } from '../messaging/default-registry.js';
import { labelConversations } from '../messaging/label-conversations.js';
import type { MessagingProviderModule, ProviderParts } from '../messaging/provider-module.js';
import { locateRecipients, locateSendRecipients } from '../people/locate-recipients.js';
import type { People } from '../people/person.js';
import type { Profiles } from '../profiles/profiles.js';

/** kernl's own words for the reply question. */
const REPLY_TEXT = Object.freeze({ title: 'How should this reply travel?' });

/** The providers the shell registers, or a registry the host built, which the shell uses as is and leaves open. */
export type MessagingModuleOptions =
  | { readonly providers: readonly MessagingProviderModule[]; readonly registry?: never }
  | { readonly registry: MessagingRegistry; readonly providers?: never };

/**
 * The active identity's signer for messages, read on every call: its account, or for a read-only
 * identity a signer that can encrypt nothing, so the person is told `signer-cannot-encrypt` and not
 * asked to sign in, by the registry and by a backend still running when the identity changes.
 */
function signerFor(context: KernelContext): () => ISigner | undefined {
  let readOnly: { readonly pubkey: string; readonly signer: ISigner | undefined } | undefined;
  return () => {
    const signer = context.signer();
    if (signer) return signer;
    const pubkey = context.identity.pubkey();
    if (!pubkey) return undefined;
    if (readOnly?.pubkey !== pubkey) readOnly = { pubkey, signer: messagingSigner(ReadonlyAccount.fromPubkey(pubkey) as IAccount) };
    return readOnly.signer;
  };
}

function registryFor(options: MessagingModuleOptions, context: KernelContext): MessagingRegistry {
  if (options.registry) return options.registry;
  const signer = signerFor(context);
  const parts: ProviderParts = {
    store: context.eventStore,
    pool: context.pool,
    tiers: context.tiers,
    storage: context.storage,
    signer,
    selfPubkey: () => context.identity.pubkey(),
    accountChanges: context.identity.pubkey$,
  };
  return createProviderMessaging({
    storage: context.storage,
    signer,
    // With nothing to draw the question the order's pick is used, as it always was (D-067).
    ...(context.canAsk('messaging.choose-reply') ? { askReply: (prompt: ReplyPrompt) => context.ask({ kind: 'messaging.choose-reply', facts: prompt, defaultText: REPLY_TEXT }) } : {}),
    providers: options.providers.map((provider) => ({ describe: provider.describe, encryption: provider.encryption, backend: () => provider.backend(parts) })),
  });
}

/** The `dm` domain over the registry: recipients read in any form of their identity, and conversations named, when those modules are loaded. */
function dmFor(registry: MessagingRegistry, context: KernelContext): DmService {
  const people = context.find<People>('people');
  const profiles = context.find<Profiles>('profiles');
  const located = people ? locateRecipients(registry.composite(), people) : registry.composite();
  const labelled = profiles ? labelConversations(located, profiles) : located;
  const service = createDmService({ adapter: { ...labelled, planRelays: () => shellRelayOrigins(context.tiers) } });
  return people ? locateSendRecipients(service, people) : service;
}

/**
 * The `dm` domain as one view over the providers a host lists, and the person's choice among them
 * as `kernl.messaging` (D-016, D-018). Each provider is its own import, so the libraries behind
 * the ones left out are never loaded. Without this module `dm` is not offered.
 *
 * @param options - The providers, in their first-run order, or a registry the host built.
 * @returns The module; its api is the `MessagingRegistry`. Load it after `people` and `profiles` for recipients in any form and named conversations.
 * @example
 * ```ts
 * const kernl = createKernel({ host, modules: [messagingModule({ providers: [privateDm(), legacyDm()] })] });
 * kernl.messaging.list().map((entry) => entry.provider.id); // ['private', 'legacy']
 * ```
 */
export function messagingModule(options: MessagingModuleOptions): KernlModule<'messaging', MessagingRegistry> {
  return {
    id: 'messaging',
    asks: ['messaging.choose-reply'],
    setup(context) {
      const registry = registryFor(options, context);
      const dm = dmFor(registry, context);
      return {
        services: { dm },
        api: registry,
        dispose() {
          dm.dispose();
          if (!options.registry) registry.close();
        },
      };
    },
  };
}
