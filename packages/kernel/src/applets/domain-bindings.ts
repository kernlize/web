import { renderNappletNamespacePrelude, type NappletNamespacePreludeOptions } from '@kehto/shell';

/**
 * One operation of a domain, as the applet calls it and as it travels: the request type,
 * the wire fields its arguments fill in order, and the field of the result it resolves with.
 *
 * The shape is `NappletBindingMethod` from kehto/web#413, declared here until a released
 * `@kehto/shell` exports it.
 */
export interface DomainBindingMethod {
  readonly type: string;
  readonly params: readonly string[];
  readonly reply: boolean;
  readonly result?: string;
}

/** What `window.napplet.<domain>` offers an applet: its operations and the messages the shell may push. */
export interface DomainBinding {
  readonly methods: Readonly<Record<string, DomainBindingMethod>>;
  readonly events?: readonly string[];
  readonly handlers?: Readonly<Record<string, readonly string[]>>;
}

/** Prelude options with the `bindings` kehto/web#413 adds; an older `@kehto/shell` ignores the field. */
export type BoundPreludeOptions = NappletNamespacePreludeOptions & { readonly bindings?: Readonly<Record<string, DomainBinding>> };

/**
 * One method of a domain binding: a request the shell answers, carrying the named params and
 * replying with the named result.
 *
 * @param type - The request's message type, such as `torrent.add`.
 * @param result - The field of the reply that holds the result.
 * @param params - The params the method takes, in order.
 * @returns The method.
 * @example
 * ```ts
 * bindingMethod('torrent.add', 'ack', 'request'); // { type: 'torrent.add', params: ['request'], reply: true, result: 'ack' }
 * ```
 */
export const bindingMethod = (type: string, result: string, ...params: string[]): DomainBindingMethod => ({ type, params, reply: true, result });
const call = bindingMethod;

const PROBE: BoundPreludeOptions = { domains: ['probe'], bindings: { probe: { methods: { ask: call('probe.ask', 'answer') } } } };


/**
 * Whether the installed `@kehto/shell` can give an applet a domain it does not build in.
 *
 * An applet reaches the shell only through the port kehto's prelude keeps to itself, so a
 * domain kehto does not know is an empty object inside the applet unless the prelude is
 * given its binding table (kehto/web#413). kernl offers the download domains only when
 * this is true: a domain an applet can see but not call would be a promise the shell
 * cannot keep.
 *
 * @param render - The prelude renderer; kehto's by default.
 * @returns True when a binding passed to the prelude reaches its output.
 * @example
 * ```ts
 * supportsDomainBindings(); // false on @kehto/shell 0.35, true once it renders bindings
 * ```
 */
export function supportsDomainBindings(render: (options: NappletNamespacePreludeOptions) => string = renderNappletNamespacePrelude): boolean {
  return render(PROBE).includes('probe.ask');
}
