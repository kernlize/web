/**
 * The nested-browsing-context lock, ported from kehto 4d8a5693
 * (`@kehto/shell` `napplet-namespace.ts`, `napplet-frame-scan.ts`,
 * `napplet-csp.ts`). The published `@kehto/shell` 0.29.0 sweeps the peer
 * connection globals from the applet's own realm only, so an applet could
 * mint a child `srcdoc` frame, a fresh realm with a working peer connection
 * that no policy reaches. Remove this port when `@kehto/shell` ships
 * `experimental.nestedContextLock`; see D-014.
 */

/** A window exposing the optional members the frame lock pins or installs. */
export interface FrameLockWindow {
  trustedTypes?: {
    createPolicy: (
      name: string,
      rules: {
        createHTML: (input: string, ...rest: unknown[]) => string;
        createScript: (input: string) => string;
        createScriptURL: (input: string) => string;
      },
    ) => unknown;
  };
  Document?: { prototype: object };
  DOMImplementation?: { prototype: object };
}

/**
 * The Trusted Types directives an applet's own CSP carries alongside the
 * zero-network baseline. `require-trusted-types-for 'script'` routes every DOM
 * string sink through the frame lock's `default` policy; `trusted-types
 * default` admits exactly that one policy name, so an applet cannot register a
 * laxer one. Ported from kehto 4d8a5693; remove when `@kehto/shell` ships
 * `nestedContextLock`.
 *
 * @example
 * ```ts
 * `${renderCsp(csp.directives)}; ${TRUSTED_TYPES_DIRECTIVES}`;
 * ```
 */
export const TRUSTED_TYPES_DIRECTIVES = "require-trusted-types-for 'script'; trusted-types default";

/**
 * Close the only two ways an element that opens a nested browsing context can
 * be minted in an applet realm, before any applet script runs. Serialised into
 * the frame-lock script by {@link renderFrameLockScript}, so it must stay one
 * self-contained function that names nothing outside itself.
 *
 * 1. HTML string sinks: a Trusted Types `default` policy, enforced by
 *    {@link TRUSTED_TYPES_DIRECTIVES}, rejects any string carrying a frame
 *    tag and passes other markup through untouched.
 * 2. Element factories: `Document.prototype.createElement` and
 *    `createElementNS`, the only element-creating methods on the platform,
 *    and `DOMImplementation.prototype.createDocument` are pinned
 *    non-configurable to reject frame tag names.
 *
 * Hardening never becomes a load-blocking failure: a policy name collision or
 * a pre-frozen prototype is skipped, and the host-side byte scan still holds.
 *
 * @param win - The applet's `window`.
 * @returns Nothing; the realm is hardened in place.
 * @example
 * ```ts
 * appletFrameLock(window);
 * document.createElement('iframe'); // throws TypeError('denied:nested-frame')
 * ```
 */
export function appletFrameLock(win: FrameLockWindow): void {
  const FRAME_ELEMENTS = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'portal', 'fencedframe']);
  const FRAME_TAG = /<\/?(?:[a-z][\w.-]*:)?(?:iframe|frame|frameset|object|embed|portal|fencedframe)(?=[\s/>]|$)/i;
  // A streaming `document.write` can split a frame tag across calls.
  const FRAME_TAG_PREFIX = /<[a-zA-Z]*$/;
  const HTML_NS = 'http://www.w3.org/1999/xhtml';
  const deny = (): never => {
    throw new TypeError('denied:nested-frame');
  };
  const localName = (qualified: unknown): string => (String(qualified ?? '').split(':').pop() as string).toLowerCase();
  const isFrameTag = (value: unknown): boolean => FRAME_ELEMENTS.has(String(value).toLowerCase());
  const isHtmlFrame = (namespace: unknown, qualified: unknown): boolean => namespace === HTML_NS && FRAME_ELEMENTS.has(localName(qualified));

  const createHTML = (input: string, ...rest: unknown[]): string => {
    const sink = rest.length >= 2 ? String(rest[1]) : '';
    const blocked = FRAME_TAG.test(input) || (/write/i.test(sink) && FRAME_TAG_PREFIX.test(input));
    return blocked ? deny() : input;
  };
  const passThrough = (input: string): string => input;
  if (win.trustedTypes) {
    try {
      win.trustedTypes.createPolicy('default', { createHTML, createScript: passThrough, createScriptURL: passThrough });
    } catch {
      // An applet cannot pre-register `default` before this runs; a collision means a host did.
    }
  }

  const pin = (target: object, name: string, value: unknown): void => {
    try {
      Object.defineProperty(target, name, { value, writable: false, configurable: false, enumerable: false });
    } catch {
      // A pre-frozen prototype keeps its factory; the byte scan still holds.
    }
  };
  type Factory = (this: unknown, ...args: unknown[]) => unknown;

  const docProto = win.Document?.prototype as Record<string, Factory> | undefined;
  if (docProto) {
    const createElement = docProto.createElement as Factory;
    const createElementNS = docProto.createElementNS as Factory;
    pin(docProto, 'createElement', function (this: unknown, tagName: unknown, ...rest: unknown[]) {
      return isFrameTag(tagName) ? deny() : createElement.call(this, tagName, ...rest);
    });
    pin(docProto, 'createElementNS', function (this: unknown, namespace: unknown, qualified: unknown, ...rest: unknown[]) {
      return isHtmlFrame(namespace, qualified) ? deny() : createElementNS.call(this, namespace, qualified, ...rest);
    });
  }

  const domProto = win.DOMImplementation?.prototype as Record<string, Factory> | undefined;
  if (domProto) {
    const createDocument = domProto.createDocument as Factory;
    pin(domProto, 'createDocument', function (this: unknown, namespace: unknown, qualified: unknown, ...rest: unknown[]) {
      return isHtmlFrame(namespace, qualified) ? deny() : createDocument.call(this, namespace, qualified, ...rest);
    });
  }
}

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
 * Serialised into the frame-lock script, so it must stay self-contained. Added
 * after an independent review found four creation routes past the factory pins
 * (D-014); the same routes affect kehto 4d8a5693.
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
 * The script that applies the frame lock to an applet realm. Insert it
 * immediately after kehto's namespace prelude, before any applet script, in a
 * document whose CSP carries {@link TRUSTED_TYPES_DIRECTIVES}. Ported from
 * kehto 4d8a5693; remove when `@kehto/shell` ships `nestedContextLock`.
 *
 * @returns An inline `<script data-kernl-frame-lock>` element.
 * @example
 * ```ts
 * const srcdoc = prepared.replace(prelude, prelude + renderFrameLockScript());
 * ```
 */
export function renderFrameLockScript(): string {
  return `<script data-kernl-frame-lock>(${appletFrameLock.toString()})(window);(${appletInsertionLock.toString()})(window);</script>`;
}

const FRAME_LOCAL_NAMES = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'portal', 'fencedframe']);
const FRAME_TAG_TOKEN = /<\/?(?:iframe|frame|frameset|object|embed|portal|fencedframe)(?=[\s/>]|$)/i;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

interface ParserHost {
  DOMParser?: new () => { parseFromString(input: string, type: string): ParentNode };
}

/** Walk a parsed subtree, `<template>` contents and shadow roots included, for an HTML frame element. */
function subtreeHasFrame(root: ParentNode): boolean {
  for (const element of Array.from(root.querySelectorAll('*'))) {
    const local = element.localName.toLowerCase();
    if (element.namespaceURI === HTML_NAMESPACE && FRAME_LOCAL_NAMES.has(local)) return true;
    const content = local === 'template' ? (element as HTMLTemplateElement).content : undefined;
    if (content && subtreeHasFrame(content)) return true;
    if (element.shadowRoot && subtreeHasFrame(element.shadowRoot)) return true;
  }
  return false;
}

/**
 * Whether verified applet markup would instantiate a nested browsing context
 * (iframe, frame, frameset, object, embed, portal, fencedframe). A static frame
 * is created by the HTML parser, which is not a Trusted Types sink, so the
 * shell scans the bytes before they become a document. With a `DOMParser` the
 * markup is parsed, so a frame tag inside a comment or a string is not
 * flagged; without one, or if parsing throws, a lexical match decides, which
 * may over-reject. Ported from kehto 4d8a5693; remove when `@kehto/shell`
 * ships `nestedContextLock`.
 *
 * @param html - Verified applet HTML.
 * @returns True when the markup declares a frame element.
 * @example
 * ```ts
 * appletMarkupHasFrame('<iframe srcdoc="x"></iframe>'); // true
 * appletMarkupHasFrame('<p>no frames</p>'); // false
 * ```
 */
export function appletMarkupHasFrame(html: string): boolean {
  const Parser = (globalThis as ParserHost).DOMParser;
  if (Parser) {
    try {
      return subtreeHasFrame(new Parser().parseFromString(html, 'text/html'));
    } catch {
      // Fall through to the conservative lexical check.
    }
  }
  return FRAME_TAG_TOKEN.test(html);
}

/**
 * Refuse verified applet markup that declares a nested browsing context. Call
 * before the bytes become a `srcdoc`. Ported from kehto 4d8a5693; remove when
 * `@kehto/shell` ships `nestedContextLock`.
 *
 * @param html - Verified applet HTML.
 * @returns Nothing when the markup has no frame element.
 * @throws `Error('denied:nested-frame')` when it has one.
 * @example
 * ```ts
 * assertAppletHasNoFrame(indexHtml);
 * ```
 */
export function assertAppletHasNoFrame(html: string): void {
  if (appletMarkupHasFrame(html)) throw new Error('denied:nested-frame');
}
