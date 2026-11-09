import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { renderInsertionLockScript } from '@kernlize/guard';
import { appletInsertionLock, type InsertionLockWindow } from '../../src/insertion-lock.js';
import type { GuardWorld } from './world.js';

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';
const OWNERS = ['Node', 'Element', 'Document', 'DocumentFragment', 'CharacterData', 'DocumentType', 'Range'] as const;
const METHODS: Record<(typeof OWNERS)[number], readonly string[]> = {
  Node: ['appendChild', 'insertBefore', 'replaceChild'],
  Element: ['append', 'prepend', 'replaceChildren', 'before', 'after', 'replaceWith', 'insertAdjacentElement', 'moveBefore'],
  Document: ['append', 'prepend', 'replaceChildren', 'moveBefore'],
  DocumentFragment: ['append', 'prepend', 'replaceChildren', 'moveBefore'],
  CharacterData: ['before', 'after', 'replaceWith'],
  DocumentType: ['before', 'after', 'replaceWith'],
  Range: ['insertNode', 'surroundContents'],
};

interface FakeNode {
  _type?: number;
  _ns?: string;
  _local?: string;
  _children?: FakeNode[];
  _content?: FakeNode;
  _shadow?: FakeNode;
}

interface InsertionRealm {
  win: InsertionLockWindow;
  protos: Record<string, Record<string, unknown>>;
  calls: string[];
  defined: string[];
  make: (fields: FakeNode, owner?: 'Element' | 'DocumentFragment') => FakeNode;
}

interface InsertionWorld extends GuardWorld {
  insertion?: InsertionRealm;
  insertionThrew?: unknown;
  script?: string;
}

function realm(world: InsertionWorld): InsertionRealm {
  if (!world.insertion) throw new Error('build an insertion realm first');
  return world.insertion;
}

function getter(read: (node: FakeNode) => unknown): PropertyDescriptor {
  return {
    configurable: true,
    get(this: FakeNode) {
      if (typeof this !== 'object' || this === null || !('_type' in this)) throw new TypeError('illegal invocation');
      return read(this);
    },
  };
}

function buildRealm(options: { frozen?: boolean; customElements?: boolean; empty?: boolean; templates?: boolean }): InsertionRealm {
  const calls: string[] = [];
  const defined: string[] = [];
  if (options.empty) return { win: {}, protos: {}, calls, defined, make: (fields) => fields };
  const protos: Record<string, Record<string, unknown>> = {};
  const nodeProto: Record<string, unknown> = {};
  Object.defineProperty(nodeProto, 'nodeType', getter((node) => node._type));
  protos.Node = nodeProto;
  const all = function (this: FakeNode) {
    return this._children ?? [];
  };
  protos.Element = Object.create(nodeProto) as Record<string, unknown>;
  Object.defineProperty(protos.Element, 'namespaceURI', getter((node) => node._ns));
  Object.defineProperty(protos.Element, 'localName', getter((node) => node._local));
  Object.defineProperty(protos.Element, 'shadowRoot', getter((node) => node._shadow));
  protos.Element.querySelectorAll = all;
  protos.DocumentFragment = Object.create(nodeProto) as Record<string, unknown>;
  protos.DocumentFragment.querySelectorAll = all;
  protos.HTMLTemplateElement = Object.create(protos.Element) as Record<string, unknown>;
  Object.defineProperty(protos.HTMLTemplateElement, 'content', getter((node) => node._content));
  if (options.templates === false) delete protos.HTMLTemplateElement;
  protos.HTMLIFrameElement = Object.create(protos.Element) as Record<string, unknown>;
  for (const owner of OWNERS) {
    protos[owner] ??= {};
    for (const method of METHODS[owner]) {
      protos[owner][method] = function () {
        calls.push(`${owner}.${method}`);
      };
    }
  }
  const win: InsertionLockWindow = { XSLTProcessor: function XSLTProcessor() {} };
  for (const [name, proto] of Object.entries(protos)) win[name] = { prototype: proto };
  if (options.customElements !== false) {
    const registry = { define: (name: string) => void defined.push(name) };
    win.CustomElementRegistry = { prototype: registry };
  }
  if (options.frozen) for (const proto of Object.values(protos)) Object.freeze(proto);
  const make = (fields: FakeNode, owner: 'Element' | 'DocumentFragment' = 'Element'): FakeNode =>
    Object.assign(Object.create((fields._local === 'template' && protos.HTMLTemplateElement) || protos[owner]) as FakeNode, fields);
  return { win, protos, calls, defined, make };
}

function frame(r: InsertionRealm, ns = HTML_NS): FakeNode {
  return r.make({ _type: 1, _ns: ns, _local: 'iframe' });
}

function paragraph(r: InsertionRealm): FakeNode {
  return r.make({ _type: 1, _ns: HTML_NS, _local: 'p' });
}

function insert(r: InsertionRealm, owner: string, method: string, node: unknown): void {
  const fn = r.protos[owner][method] as (...args: unknown[]) => unknown;
  fn.call({}, owner === 'Element' && method === 'insertAdjacentElement' ? 'beforeend' : node, node);
}

Given('an insertion-lock realm with every insertion method', (world: InsertionWorld) => {
  world.insertion = buildRealm({});
});

Given('an insertion-lock realm with frozen prototypes and no custom elements', (world: InsertionWorld) => {
  world.insertion = buildRealm({ frozen: true, customElements: false });
});

Given('an insertion-lock realm without templates', (world: InsertionWorld) => {
  world.insertion = buildRealm({ templates: false });
});

Given('an empty insertion-lock realm', (world: InsertionWorld) => {
  world.insertion = buildRealm({ empty: true });
});

When('the insertion lock is applied to the realm', (world: InsertionWorld) => {
  try {
    appletInsertionLock(realm(world).win);
  } catch (error) {
    world.insertionThrew = error;
  }
});

Then('the insertion lock did not throw', (world: InsertionWorld) => {
  expect(world.insertionThrew).toBeUndefined();
});

Then('inserting a frame with {string} {string} is refused', (world: InsertionWorld, owner: string, method: string) => {
  const r = realm(world);
  expect(() => insert(r, owner, method, frame(r))).toThrow('denied:nested-frame');
  expect(r.calls).toEqual([]);
});

Then('inserting a frame with {string} {string} is delegated', (world: InsertionWorld, owner: string, method: string) => {
  const r = realm(world);
  insert(r, owner, method, frame(r));
  expect(r.calls).toEqual([`${owner}.${method}`]);
});

Then('inserting a paragraph with {string} {string} is delegated', (world: InsertionWorld, owner: string, method: string) => {
  const r = realm(world);
  insert(r, owner, method, paragraph(r));
  expect(r.calls).toContain(`${owner}.${method}`);
});

function refused(r: InsertionRealm, node: FakeNode): void {
  expect(() => insert(r, 'Node', 'appendChild', node)).toThrow('denied:nested-frame');
}

Then('inserting an element whose descendant is a frame is refused', (world: InsertionWorld) => {
  const r = realm(world);
  refused(r, r.make({ _type: 1, _ns: HTML_NS, _local: 'div', _children: [paragraph(r), frame(r)] }));
});

Then('inserting a fragment whose descendant is a frame is refused', (world: InsertionWorld) => {
  const r = realm(world);
  refused(r, r.make({ _type: 11, _children: [frame(r)] }, 'DocumentFragment'));
});

Then('inserting a template whose content holds a frame is refused', (world: InsertionWorld) => {
  const r = realm(world);
  const content = r.make({ _type: 11, _children: [frame(r)] }, 'DocumentFragment');
  refused(r, r.make({ _type: 1, _ns: HTML_NS, _local: 'template', _content: content }));
  const inner = r.make({ _type: 1, _ns: HTML_NS, _local: 'template', _content: content });
  refused(r, r.make({ _type: 1, _ns: HTML_NS, _local: 'div', _children: [inner] }));
});

Then('inserting an element whose shadow root holds a frame is refused', (world: InsertionWorld) => {
  const r = realm(world);
  const shadow = r.make({ _type: 11, _children: [frame(r)] }, 'DocumentFragment');
  refused(r, r.make({ _type: 1, _ns: HTML_NS, _local: 'div', _shadow: shadow }));
});

Then('inserting a frame in a foreign namespace is delegated', (world: InsertionWorld) => {
  const r = realm(world);
  r.calls.length = 0;
  insert(r, 'Node', 'appendChild', frame(r, SVG_NS));
  expect(r.calls).toEqual(['Node.appendChild']);
});

Then('inserting text and non-nodes is delegated', (world: InsertionWorld) => {
  const r = realm(world);
  r.calls.length = 0;
  insert(r, 'Element', 'append', 'plain text');
  insert(r, 'Element', 'append', null);
  insert(r, 'Element', 'append', r.make({ _type: 3 }));
  insert(r, 'Element', 'append', { not: 'a node' });
  expect(r.calls).toEqual(['Element.append', 'Element.append', 'Element.append', 'Element.append']);
});

Then('inserting a frame that claims to be a {string} is refused', (world: InsertionWorld, claimed: string) => {
  const r = realm(world);
  const disguised = frame(r);
  Object.defineProperty(disguised, 'localName', { value: claimed });
  Object.defineProperty(disguised, 'namespaceURI', { value: SVG_NS });
  refused(r, disguised);
});

function define(r: InsertionRealm, ...args: unknown[]): void {
  const registry = (r.win.CustomElementRegistry as { prototype: { define: (...a: unknown[]) => void } }).prototype;
  registry.define(...args);
}

Then('defining a custom element that extends {string} is refused', (world: InsertionWorld, tag: string) => {
  expect(() => define(realm(world), 'x-frame', class {}, { extends: tag })).toThrow('denied:nested-frame');
});

Then('defining a custom element whose class inherits a frame element is refused', (world: InsertionWorld) => {
  const r = realm(world);
  const ctor: { prototype: object } = { prototype: Object.create(Object.create(r.protos.HTMLIFrameElement) as object) as object };
  expect(() => define(r, 'x-sub', ctor, { extends: 'p' })).toThrow('denied:nested-frame');
});

Then('defining an ordinary custom element is delegated', (world: InsertionWorld) => {
  const r = realm(world);
  define(r, 'x-ok', class {});
  expect(r.defined).toEqual(['x-ok']);
});

Then('defining a custom element with no class is delegated', (world: InsertionWorld) => {
  const r = realm(world);
  define(r, 'x-empty', undefined);
  expect(r.defined.at(-1)).toBe('x-empty');
});

Then('the realm has no XSLT processor', (world: InsertionWorld) => {
  expect(realm(world).win.XSLTProcessor).toBeUndefined();
});

Then("the realm's insertion methods cannot be redefined", (world: InsertionWorld) => {
  const r = realm(world);
  const descriptor = Object.getOwnPropertyDescriptor(r.protos.Node, 'appendChild');
  expect(descriptor?.configurable).toBe(false);
  expect(descriptor?.writable).toBe(false);
});

function script(world: InsertionWorld): string {
  if (world.script === undefined) throw new Error('render the insertion-lock script first');
  return world.script;
}

When('the guard renders the insertion-lock script', (world: InsertionWorld) => {
  world.script = renderInsertionLockScript();
});

Then('the insertion-lock script opens with {string} and closes with {string}', (world: InsertionWorld, open: string, close: string) => {
  expect(script(world).startsWith(open)).toBe(true);
  expect(script(world).endsWith(close)).toBe(true);
});

Then('the insertion-lock script closes no element before its end', (world: InsertionWorld) => {
  expect(script(world).indexOf('</')).toBe(script(world).length - '</script>'.length);
});

Then('the insertion-lock script applies the insertion lock', (world: InsertionWorld) => {
  expect(script(world)).toContain('appletInsertionLock');
  expect(script(world).match(/\(window\);/g)).toHaveLength(1);
});
