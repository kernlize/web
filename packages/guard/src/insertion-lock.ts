/**
 * kernl's insertion lock, layered on kehto's nested-context lock (D-014).
 *
 * `@kehto/shell` 0.30.0 ships the creation lock, enabled with
 * `experimental.nestedContextLock`: the srcdoc CSP gains the Trusted Types
 * directives, its prelude installs a `default` policy that refuses frame
 * markup at every string sink and pins `createElement`, `createElementNS` and
 * `createDocument`, and `assertNappletHasNoFrame` refuses static frame markup
 * before the bytes become a document. That lock guards creation only. Four
 * routes still mint a frame element past it: a customized built-in's
 * constructor called with `new`, XSLT `transformToFragment`, and a
 * namespace-prefixed XHTML frame brought in through `importNode` or
 * `adoptNode` (kehto's frame-tag pattern does not match a prefixed tag). kernl
 * closes them where they all converge, at insertion, until kehto does; the
 * routes are to be reported to kehto.
 */

/** A window as the insertion lock sees it: constructors looked up by name. */
export type InsertionLockWindow = Record<string, unknown>;

type Method = (this: unknown, ...args: unknown[]) => unknown;

/**
 * Refuse every way of connecting a frame element to a document. A frame gets a
 * browsing context, and so a fresh realm, only when it is connected; creation
 * routes are many (custom element constructors, XSLT, namespaced XML parsing)
 * but insertion is one small set of methods, so the lock holds there. Node
 * identity is read through native getters captured before any applet script,
 * so an element cannot disguise itself by overriding `localName`. Also refuses
 * custom elements that extend a frame element and removes `XSLTProcessor`.
 * Serialised into the insertion-lock script by {@link renderInsertionLockScript},
 * so it must stay self-contained. Added after an independent review found four
 * creation routes past kehto's factory pins (D-014).
 *
 * @param win - The applet's `window`.
 * @returns Nothing; the realm is hardened in place.
 * @example
 * ```ts
 * appletInsertionLock(window);
 * document.body.append(frameFromAnywhere); // throws TypeError('denied:nested-frame')
 * ```
 */
export function appletInsertionLock(win: InsertionLockWindow): void {
  const NAMES = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'portal', 'fencedframe']);
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const deny = (): never => {
    throw new TypeError('denied:nested-frame');
  };
  const prototypeOf = (name: string): Record<string, unknown> | undefined =>
    (win[name] as { prototype?: Record<string, unknown> } | undefined)?.prototype;
  const native = (owner: string, prop: string): ((node: object, ...args: unknown[]) => unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototypeOf(owner) ?? {}, prop);
    const fn = descriptor?.get ?? descriptor?.value;
    return (node, ...args) => {
      try {
        return typeof fn === 'function' ? (fn as Method).apply(node, args) : undefined;
      } catch {
        return undefined;
      }
    };
  };
  const nodeType = native('Node', 'nodeType');
  const namespaceOf = native('Element', 'namespaceURI');
  const localNameOf = native('Element', 'localName');
  const shadowOf = native('Element', 'shadowRoot');
  const contentOf = native('HTMLTemplateElement', 'content');
  const elementAll = native('Element', 'querySelectorAll');
  const fragmentAll = native('DocumentFragment', 'querySelectorAll');
  const isFrame = (node: object): boolean =>
    nodeType(node) === 1 && namespaceOf(node) === HTML_NS && NAMES.has(String(localNameOf(node)).toLowerCase());
  const holdsFrame = (node: unknown): boolean => {
    if (typeof node !== 'object' || node === null) return false;
    if (isFrame(node)) return true;
    const type = nodeType(node);
    const all = type === 1 ? elementAll(node, '*') : type === 11 ? fragmentAll(node, '*') : undefined;
    const roots: unknown[] = [contentOf(node), shadowOf(node)];
    for (const element of Array.from((all as ArrayLike<object> | undefined) ?? [])) {
      if (isFrame(element)) return true;
      roots.push(contentOf(element), shadowOf(element));
    }
    return roots.some(holdsFrame);
  };
  const pin = (target: object, name: string, value: unknown): void => {
    try {
      Object.defineProperty(target, name, { value, writable: false, configurable: false, enumerable: false });
    } catch {
      // A pre-frozen prototype keeps its method; the remaining pins still hold.
    }
  };
  const INSERTS: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['Node', ['appendChild', 'insertBefore', 'replaceChild']],
    ['Element', ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith', 'insertAdjacentElement', 'moveBefore']],
    ['Document', ['append', 'prepend', 'replaceChildren', 'moveBefore']],
    ['DocumentFragment', ['append', 'prepend', 'replaceChildren', 'moveBefore']],
    ['CharacterData', ['before', 'after', 'replaceWith']],
    ['DocumentType', ['before', 'after', 'replaceWith']],
    ['Range', ['insertNode', 'surroundContents']],
  ];
  for (const [owner, names] of INSERTS) {
    const proto = prototypeOf(owner);
    for (const name of names) {
      const original = proto?.[name];
      if (!proto || typeof original !== 'function') continue;
      pin(proto, name, function (this: unknown, ...args: unknown[]) {
        return args.some(holdsFrame) ? deny() : (original as Method).apply(this, args);
      });
    }
  }
  const registry = prototypeOf('CustomElementRegistry');
  const define = registry?.define;
  const frameProtos = ['HTMLIFrameElement', 'HTMLFrameElement', 'HTMLFrameSetElement', 'HTMLObjectElement', 'HTMLEmbedElement']
    .map(prototypeOf)
    .filter(Boolean);
  if (registry && typeof define === 'function') {
    pin(registry, 'define', function (this: unknown, name: unknown, ctor: { prototype?: object } | undefined, options?: { extends?: unknown }) {
      if (NAMES.has(String(options?.extends ?? '').toLowerCase())) deny();
      for (let proto: object | null | undefined = ctor?.prototype; proto; proto = Object.getPrototypeOf(proto)) {
        if (frameProtos.includes(proto as Record<string, unknown>)) deny();
      }
      return (define as Method).call(this, name, ctor, options);
    });
  }
  if ('XSLTProcessor' in win) pin(win, 'XSLTProcessor', undefined);
}

/**
 * The script that applies the insertion lock to an applet realm. Insert it
 * immediately after kehto's namespace prelude (rendered with
 * `experimental.nestedContextLock`), before any applet script.
 *
 * @returns An inline `<script data-kernl-insertion-lock>` element.
 * @example
 * ```ts
 * const srcdoc = prepared.replace(meta + prelude, meta + prelude + renderInsertionLockScript());
 * ```
 */
export function renderInsertionLockScript(): string {
  return `<script data-kernl-insertion-lock>(${appletInsertionLock.toString()})(window);</script>`;
}
