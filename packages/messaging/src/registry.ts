import { createCompositeBackend, type ReplyChoice } from './composite.js';
import { arrange } from './order.js';
import type {
  MessagingBackend,
  MessagingPreferences,
  MessagingProvider,
  MessagingRegistry,
  ProviderEntry,
  ReplyAnswer,
  ReplyPrompt,
  ReplyRule,
  SavedMessagingPreferences,
} from './types.js';

/** Options for {@link createMessagingRegistry}. */
export interface MessagingRegistryOptions {
  /** Preferences saved by an earlier session. Providers named here are enabled as they are registered. */
  readonly preferences?: SavedMessagingPreferences;
  /** Called with a frozen snapshot after every change to the preferences. */
  readonly onChange?: (preferences: MessagingPreferences) => void;
  /**
   * Ask the user which provider a reply should use when the person it is for last wrote through
   * another one. Resolve `undefined` on dismiss, which stops the send with `denied:cancelled`.
   * Without it the message leaves through the provider the order picked.
   */
  readonly askReply?: (prompt: ReplyPrompt) => Promise<ReplyAnswer | undefined>;
}

type Settled = Exclude<ReplyRule, 'ask'>;

interface ReplyState {
  rule: ReplyRule;
  readonly choices: Map<string, Settled>;
}

/** The order an earlier session saved; one saved before there was an order starts with its default. */
function savedOrder(saved: SavedMessagingPreferences | undefined): string[] {
  if (saved?.order) return [...saved.order];
  return saved?.defaultProvider === undefined ? [] : [saved.defaultProvider];
}

/**
 * Settle one {@link ReplyChoice}: a choice kept for the person wins, then the rule, then the user.
 * An answer the user asked to keep is written to `state` before `changed` is called.
 */
async function decideReply(
  choice: ReplyChoice,
  state: ReplyState,
  ask: ((choice: ReplyChoice) => Promise<ReplyAnswer | undefined>) | undefined,
  changed: () => void,
): Promise<string> {
  const pick = (use: Settled): string => (use === 'theirs' ? choice.theirs : choice.mine);
  const settled = state.choices.get(choice.peer.pubkey) ?? (state.rule === 'ask' ? undefined : state.rule);
  if (settled) return pick(settled);
  if (!ask) return choice.mine;
  const answer = await ask(choice);
  if (!answer) throw new Error('denied:cancelled');
  if (answer.remember === 'conversation') state.choices.set(choice.peer.pubkey, answer.use);
  if (answer.remember === 'always') state.rule = answer.use;
  if (answer.remember !== 'once') changed();
  return pick(answer.use);
}

/**
 * Create the shell's provider registry.
 *
 * The registry owns one backend per enabled provider and hands out a single
 * composite backend for the NAP `dm` service. Preferences restored at
 * construction are applied lazily: a provider that appears in the saved
 * `enabled` list is started the moment it is registered, if it is available.
 * One that cannot run yet (nobody is signed in, say) reports why through
 * `list()`, stays in the saved `enabled` list, and is started the next time
 * the registry is read after it became available. Switching it off forgets it.
 *
 * Providers are kept in the user's order. A provider joins the end of it when
 * it is registered, unless the saved order already places it. The first
 * enabled provider in the order is the default: a message to someone new
 * leaves through it, and when it cannot reach them the next one is tried.
 *
 * When a one-to-one message would leave through a provider other than the one
 * its recipient last wrote through, the reply rule decides: `theirs` follows
 * the correspondent, `mine` keeps the order's pick, and `ask` (the default)
 * puts the question to `askReply`, whose answer can settle it for that person
 * or for everyone.
 *
 * `close()` closes every backend without touching the preferences, so a
 * shutdown never erases what the user chose. A closed registry is not reused.
 *
 * @param options - Saved preferences, a change listener and the reply question.
 * @returns A `MessagingRegistry`.
 * @example
 * ```ts
 * const registry = createMessagingRegistry({
 *   preferences: load(),
 *   onChange: (prefs) => save(prefs),
 * });
 * registry.register(createPrivateMessagesProvider(deps));
 * registry.register(createLegacyMessagesProvider(deps));
 * registry.enable('private');
 * registry.setOrder(['legacy', 'private']);
 * registry.preferences().defaultProvider; // 'private': the first one that is enabled
 * ```
 */
export function createMessagingRegistry(options: MessagingRegistryOptions = {}): MessagingRegistry {
  const providers = new Map<string, MessagingProvider>();
  const backends = new Map<string, MessagingBackend>();
  /** Providers the user wants on that cannot run yet; each starts as soon as it can. */
  const waiting = new Set(options.preferences?.enabled ?? []);
  const reply: ReplyState = {
    rule: options.preferences?.reply ?? 'ask',
    choices: new Map(Object.entries(options.preferences?.replyChoices ?? {})),
  };
  let order = savedOrder(options.preferences);
  let composite: MessagingBackend | undefined;

  const ordered = (): string[] => order.filter((id) => providers.has(id));
  const enabledIds = (): string[] => ordered().filter((id) => backends.has(id));

  const snapshot = (): MessagingPreferences => {
    const first = enabledIds()[0];
    return Object.freeze({
      enabled: Object.freeze(ordered().filter((id) => backends.has(id) || waiting.has(id))),
      order: Object.freeze(ordered()),
      ...(first === undefined ? {} : { defaultProvider: first }),
      reply: reply.rule,
      replyChoices: Object.freeze(Object.fromEntries(reply.choices)),
    });
  };

  const notify = (): void => options.onChange?.(snapshot());

  const lookup = (id: string): MessagingProvider => {
    const provider = providers.get(id);
    if (!provider) throw new Error('invalid:unknown-provider');
    return provider;
  };

  const entryFor = (provider: MessagingProvider): ProviderEntry => ({
    provider,
    enabled: backends.has(provider.id),
    availability: provider.availability(),
  });

  const activate = (provider: MessagingProvider): void => {
    const availability = provider.availability();
    if (!availability.available) throw new Error(`unavailable:${availability.reason}`);
    backends.set(provider.id, provider.createBackend());
  };

  /** Start every waiting provider that can run now. Called wherever the registry is read, so a sign-in needs no announcement. */
  const settle = (): void => {
    const ready = ordered().filter((id) => waiting.has(id) && lookup(id).availability().available);
    for (const id of ready) {
      waiting.delete(id);
      activate(lookup(id));
    }
    if (ready.length > 0) notify();
  };

  const ask = options.askReply;
  const askUser = ask && ((choice: ReplyChoice) => ask({ peer: choice.peer, theirs: lookup(choice.theirs), mine: lookup(choice.mine) }));

  return {
    register(provider) {
      if (providers.has(provider.id)) throw new Error('invalid:duplicate-provider');
      providers.set(provider.id, provider);
      if (!order.includes(provider.id)) order.push(provider.id);
      settle();
    },
    list() {
      settle();
      return ordered().map((id) => entryFor(lookup(id)));
    },
    get(id) {
      settle();
      const provider = providers.get(id);
      return provider && entryFor(provider);
    },
    enable(id) {
      const provider = lookup(id);
      if (backends.has(id)) return;
      activate(provider);
      waiting.delete(id);
      notify();
    },
    disable(id) {
      lookup(id);
      const backend = backends.get(id);
      if (!backend && !waiting.delete(id)) return;
      backend?.close?.();
      backends.delete(id);
      notify();
    },
    setDefault(id) {
      if (!backends.has(id)) throw new Error('invalid:provider-not-enabled');
      order = arrange(order, [id]);
      notify();
    },
    setOrder(ids) {
      ids.forEach(lookup);
      order = arrange(order, ids);
      notify();
    },
    setReplyRule(rule) {
      reply.rule = rule;
      notify();
    },
    forgetReplyChoice(pubkey) {
      if (pubkey === undefined) reply.choices.clear();
      else reply.choices.delete(pubkey);
      notify();
    },
    preferences() {
      settle();
      return snapshot();
    },
    composite() {
      composite ??= createCompositeBackend(
        () => (settle(), enabledIds().map((id) => ({ id, backend: backends.get(id) as MessagingBackend }))),
        () => enabledIds()[0],
        { chooseReply: (choice) => decideReply(choice, reply, askUser, notify) },
      );
      return composite;
    },
    close() {
      for (const backend of backends.values()) backend.close?.();
    },
  };
}
