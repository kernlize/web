import { createCatalogIntentResolver, type IntentCandidate, type IntentDispatchParams, type IntentRequest, type IntentResolver, type IntentResult } from '@kehto/services';
import type { HandlerChoice, HandlerOption, HandlerPrompt } from '../types.js';
import type { HandlerDefaults } from './defaults.js';
import type { InstalledApplet, InstalledApplets } from './installed.js';
import { catalogIdForRef, preferredHandlers } from './preferences.js';

/** What {@link createIntentRouter} needs. */
export interface IntentRouterOptions {
  readonly installed: InstalledApplets;
  readonly defaults: HandlerDefaults;
  /** Ask the user to pick a handler; absent in hosts with no chooser. */
  readonly choose?: (prompt: HandlerPrompt) => Promise<HandlerChoice | undefined>;
  /** A plain name for the applet that asked, from its runtime-attested catalogue id. */
  readonly describeSender: (sender: string) => string;
  /** Start or reuse the target and deliver; the promise settles when delivery succeeded or failed for good. */
  readonly deliver: (params: IntentDispatchParams) => Promise<void>;
}

/** kehto's resolver plus the shell's change notifications. */
export interface IntentRouter extends IntentResolver {
  notifyChanged(archetype: string): void;
}

/** Failures the shell answers by offering to find a handler in the store. */
const NO_HANDLER: ReadonlySet<string> = new Set(['no handler', 'unsupported convention', 'unsupported action']);

const isExplicit = (handler: string | undefined): boolean => handler !== undefined && handler !== 'default' && handler !== 'choose';

/**
 * kernl's NAP-INTENT routing over kehto's `createCatalogIntentResolver`.
 *
 * kehto applies the spec's precedence and exact convention matching; kernl
 * supplies the installed catalogue, the user's defaults, the chooser and
 * delivery. The user's published preferences rank the chooser and pre-select a
 * handler when exactly one compatible preferred handler is installed. When no
 * installed applet can take the request, the user is asked once to pick one
 * from the store; a handler picked that way is used for this request only
 * through a one-time explicit authorisation, so an applet can never address a
 * handler the user did not choose (NAP-INTENT, "Runtime Behavior").
 *
 * @param options - Installed set, defaults, chooser, sender names and delivery.
 * @returns The resolver for kehto's intent service.
 * @example
 * ```ts
 * const router = createIntentRouter({ installed, defaults, choose, describeSender, deliver });
 * createIntentService({ resolver: router, resolveSender });
 * ```
 */
export function createIntentRouter(options: IntentRouterOptions): IntentRouter {
  const { installed, defaults } = options;
  const pending = new Map<string, IntentRequest>();
  const rerouted = new Map<string, string>();
  const authorised = new Set<string>();
  const pairKey = (sender: string, handler: string): string => `${sender}\n${handler}`;

  async function ask(request: IntentRequest, candidates: readonly IntentCandidate[], sender: string): Promise<HandlerChoice | undefined> {
    if (!options.choose) return undefined;
    const preferred = preferredHandlers(defaults.synced(request.archetype), request.convention);
    const rank = (id: string): number => (preferred.includes(id) ? preferred.indexOf(id) : preferred.length);
    const choices: HandlerOption[] = candidates
      .map((candidate) => {
        // Candidates come from the installed catalogue, so each one is installed.
        const applet = installed.get(candidate.id) as InstalledApplet;
        return { id: candidate.id, title: applet.title, address: applet.address, preferred: preferred.includes(candidate.id) };
      })
      .sort((a, b) => rank(a.id) - rank(b.id));
    const hint = request.handlerHint?.address;
    const choice = await options.choose({
      archetype: request.archetype,
      action: request.action,
      convention: request.convention,
      source: options.describeSender(sender),
      options: choices,
      ...(hint ? { recommended: hint } : {}),
    });
    if (choice?.remember) await defaults.set(request.archetype, choice.id).catch(() => undefined);
    return choice;
  }

  async function chooseHandler(archetype: string, candidates: readonly IntentCandidate[], sender: string): Promise<string | undefined> {
    // kehto calls this only from inside `invoke`, which recorded the request for this sender.
    const request = pending.get(sender) as IntentRequest;
    const preferred = preferredHandlers(defaults.synced(archetype), request.convention).filter((id) => candidates.some((candidate) => candidate.id === id));
    if (preferred.length === 1 && request.handler !== 'choose') return preferred[0];
    const choice = await ask(request, candidates, sender);
    if (choice && !candidates.some((candidate) => candidate.id === choice.id)) {
      rerouted.set(sender, choice.id);
      return undefined;
    }
    return choice?.id;
  }

  const resolver = createCatalogIntentResolver({
    loadCatalog: () => installed.catalog(),
    targets: { accept: (params) => ({ completion: options.deliver(params) }) },
    getDefaultHandler: (archetype) => {
      const id = defaults.get(archetype);
      return id && installed.get(id) ? id : undefined;
    },
    // Without a chooser kehto refuses an undecided request as "invoke rejected"; with one, a dismissal is "user cancelled".
    ...(options.choose ? { chooseHandler } : {}),
    authorizeExplicitHandler: (sender, handler) => authorised.delete(pairKey(sender, handler)),
    resolveHandlerHint: (hint, candidates) => candidates.find((candidate) => candidate.id === catalogIdForRef(hint.address))?.id,
  });

  async function rerouteFor(request: IntentRequest, result: Extract<IntentResult, { ok: false }>, sender: string): Promise<string | undefined> {
    const picked = rerouted.get(sender);
    rerouted.delete(sender);
    if (picked) return picked;
    if (!NO_HANDLER.has(result.error) || isExplicit(request.handler)) return undefined;
    return (await ask(request, [], sender))?.id;
  }

  return {
    async invoke(request, context) {
      pending.set(context.sender, request);
      let handler: string | undefined;
      try {
        const result = await resolver.invoke(request, context);
        if (result.ok) return result;
        handler = await rerouteFor(request, result, context.sender);
        if (!handler || !installed.get(handler)) return result;
        authorised.add(pairKey(context.sender, handler));
        return await resolver.invoke({ ...request, handler }, context);
      } finally {
        pending.delete(context.sender);
        if (handler) authorised.delete(pairKey(context.sender, handler));
      }
    },
    available: (archetype) => resolver.available(archetype),
    handlers: () => resolver.handlers(),
    // kehto's catalogue resolver always implements it; the interface marks it optional for other resolvers.
    onChanged: resolver.onChanged as NonNullable<IntentResolver['onChanged']>,
    notifyChanged: (archetype) => resolver.notifyChanged(archetype),
  };
}
