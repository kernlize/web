import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import { appletMarkupHasFrame, assertAppletHasNoFrame, createAppletCsp, renderFrameLockScript } from '@kernl/guard';
import { appletFrameLock, type FrameLockWindow } from '../../src/frame-lock.js';
import type { GuardWorld } from './world.js';

const HTML_NS = 'http://www.w3.org/1999/xhtml';
const SVG_NS = 'http://www.w3.org/2000/svg';

type CreateHTML = (input: string, ...rest: unknown[]) => string;
type Rules = { createHTML: CreateHTML; createScript: (input: string) => string; createScriptURL: (input: string) => string };
type Factory = (...args: unknown[]) => unknown;

interface Realm {
  win: FrameLockWindow;
  policies: Array<{ name: string; rules: Rules }>;
  documentProto: Record<string, Factory>;
  domProto: Record<string, Factory>;
  calls: Array<{ receiver: unknown; args: unknown[] }>;
  threw?: unknown;
}

interface FrameWorld extends GuardWorld {
  realm?: Realm;
  script?: string;
}

function realm(world: FrameWorld): Realm {
  if (!world.realm) throw new Error('build a realm first');
  return world.realm;
}

function recordingFactory(calls: Realm['calls']): Factory {
  return function (this: unknown, ...args: unknown[]) {
    calls.push({ receiver: this, args });
    return { created: args };
  };
}

function buildRealm(options: { trustedTypes: boolean; factories: boolean; takenPolicy?: boolean; frozen?: boolean }): Realm {
  const calls: Realm['calls'] = [];
  const policies: Realm['policies'] = [];
  const documentProto: Record<string, Factory> = { createElement: recordingFactory(calls), createElementNS: recordingFactory(calls) };
  const domProto: Record<string, Factory> = { createDocument: recordingFactory(calls) };
  if (options.frozen) {
    Object.freeze(documentProto);
    Object.freeze(domProto);
  }
  const win: FrameLockWindow = {};
  if (options.trustedTypes) {
    win.trustedTypes = {
      createPolicy: (name, rules) => {
        if (options.takenPolicy) throw new TypeError('policy exists');
        policies.push({ name, rules });
        return {};
      },
    };
  }
  if (options.factories) {
    win.Document = { prototype: documentProto };
    win.DOMImplementation = { prototype: domProto };
  }
  return { win, policies, documentProto, domProto, calls };
}

function policy(world: FrameWorld): Rules {
  const [first] = realm(world).policies;
  if (!first) throw new Error('no policy registered');
  return first.rules;
}

function refusal(body: () => unknown): string {
  try {
    body();
  } catch (error) {
    return `${(error as Error).name}: ${(error as Error).message}`;
  }
  return 'delegated';
}

Then('the guard CSP Trusted Types directives are {string}', (_world: GuardWorld, directives: string) => {
  expect(createAppletCsp('strict').trustedTypes).toBe(directives);
});

When('the guard renders the frame-lock script', (world: FrameWorld) => {
  world.script = renderFrameLockScript();
});

Then('the frame-lock script opens with {string} and closes with {string}', (world: FrameWorld, open: string, close: string) => {
  expect(world.script?.startsWith(open)).toBe(true);
  expect(world.script?.endsWith(close)).toBe(true);
});

Then('the frame-lock script closes no element before its end', (world: FrameWorld) => {
  expect(world.script?.indexOf('</')).toBe((world.script?.length ?? 0) - '</script>'.length);
});

Given('an applet realm with Trusted Types, element factories and a document factory', (world: FrameWorld) => {
  world.realm = buildRealm({ trustedTypes: true, factories: true });
});

Given('an applet realm whose Trusted Types policy name is taken and whose prototypes are frozen', (world: FrameWorld) => {
  world.realm = buildRealm({ trustedTypes: true, factories: true, takenPolicy: true, frozen: true });
});

Given('an applet realm with nothing to harden', (world: FrameWorld) => {
  world.realm = buildRealm({ trustedTypes: false, factories: false });
});

When('the frame lock is applied to the realm', (world: FrameWorld) => {
  const target = realm(world);
  try {
    appletFrameLock(target.win);
  } catch (error) {
    target.threw = error;
  }
});

Then('the frame lock did not throw', (world: FrameWorld) => {
  expect(realm(world).threw).toBeUndefined();
});

Then('the realm registered one Trusted Types policy named {string}', (world: FrameWorld, name: string) => {
  expect(realm(world).policies.map((entry) => entry.name)).toEqual([name]);
});

Then('the policy passes {string} for {string}', (world: FrameWorld, input: string, sink: string) => {
  expect(policy(world).createHTML(input, 'TrustedHTML', sink)).toBe(input);
});

Then('the policy passes {string} with no sink named', (world: FrameWorld, input: string) => {
  expect(policy(world).createHTML(input)).toBe(input);
});

Then('the policy refuses {string} for {string}', (world: FrameWorld, input: string, sink: string) => {
  expect(refusal(() => policy(world).createHTML(input, 'TrustedHTML', sink))).toBe('TypeError: denied:nested-frame');
});

Then('the policy passes scripts and script addresses through', (world: FrameWorld) => {
  expect(policy(world).createScript('1 + 1')).toBe('1 + 1');
  expect(policy(world).createScriptURL('blob:x')).toBe('blob:x');
});

Then('creating element {string} in the realm is refused', (world: FrameWorld, tag: string) => {
  const proto = realm(world).documentProto;
  expect(refusal(() => proto.createElement?.call(proto, tag))).toBe('TypeError: denied:nested-frame');
});

Then('creating element {string} in the realm is delegated with the document as receiver', (world: FrameWorld, tag: string) => {
  const target = realm(world);
  const receiver = { document: true };
  expect(refusal(() => target.documentProto.createElement?.call(receiver, tag, { is: 'x' }))).toBe('delegated');
  expect(target.calls.at(-1)).toEqual({ receiver, args: [tag, { is: 'x' }] });
});

Then('creating {string} in the HTML namespace is refused', (world: FrameWorld, name: string) => {
  const proto = realm(world).documentProto;
  expect(refusal(() => proto.createElementNS?.call(proto, HTML_NS, name))).toBe('TypeError: denied:nested-frame');
});

Then('creating {string} in the SVG namespace is delegated', (world: FrameWorld, name: string) => {
  const target = realm(world);
  expect(refusal(() => target.documentProto.createElementNS?.call(target.documentProto, SVG_NS, name, {}))).toBe('delegated');
  expect(target.calls.at(-1)?.args).toEqual([SVG_NS, name, {}]);
});

Then('creating a nameless element in the HTML namespace is delegated', (world: FrameWorld) => {
  const proto = realm(world).documentProto;
  expect(refusal(() => proto.createElementNS?.call(proto, HTML_NS, null))).toBe('delegated');
});

Then('creating a document rooted at {string} in the HTML namespace is refused', (world: FrameWorld, name: string) => {
  const proto = realm(world).domProto;
  expect(refusal(() => proto.createDocument?.call(proto, HTML_NS, name))).toBe('TypeError: denied:nested-frame');
});

Then('creating a document rooted at {string} in the HTML namespace is delegated', (world: FrameWorld, name: string) => {
  const target = realm(world);
  expect(refusal(() => target.domProto.createDocument?.call(target.domProto, HTML_NS, name, null))).toBe('delegated');
  expect(target.calls.at(-1)?.args).toEqual([HTML_NS, name, null]);
});

Then("the realm's factories cannot be redefined", (world: FrameWorld) => {
  const { documentProto, domProto } = realm(world);
  for (const [target, name] of [[documentProto, 'createElement'], [documentProto, 'createElementNS'], [domProto, 'createDocument']] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    expect(descriptor).toMatchObject({ writable: false, configurable: false, enumerable: false });
    expect(() => Object.defineProperty(target, name, { value: () => undefined })).toThrow(TypeError);
  }
});

Then('applet markup {string} has a frame: {word}', (_world: GuardWorld, markup: string, answer: string) => {
  expect(appletMarkupHasFrame(markup)).toBe(answer === 'yes');
});

interface FakeElement {
  localName: string;
  namespaceURI: string;
  content?: FakeTree;
  shadowRoot?: FakeTree | null;
}

interface FakeTree {
  querySelectorAll(selector: string): FakeElement[];
}

function tree(...elements: FakeElement[]): FakeTree {
  return { querySelectorAll: (selector) => (selector === '*' ? elements : []) };
}

const element = (localName: string, namespaceURI = HTML_NS, extra: Partial<FakeElement> = {}): FakeElement => ({ localName, namespaceURI, shadowRoot: null, ...extra });

const PARSED: Readonly<Record<string, FakeTree>> = {
  'html-frame': tree(element('body'), element('IFRAME')),
  'svg-frame': tree(element('svg', SVG_NS), element('iframe', SVG_NS)),
  'template-frame': tree(element('template', HTML_NS, { content: tree(element('embed')) })),
  'shadow-frame': tree(element('div', HTML_NS, { shadowRoot: tree(element('object')) })),
  plain: tree(element('template', HTML_NS, { content: tree(element('p')) }), element('div', HTML_NS, { shadowRoot: tree(element('span')) })),
};

class FakeParser {
  parseFromString(input: string, type: string): FakeTree {
    const parsed = PARSED[input];
    if (!parsed || type !== 'text/html') throw new Error('unparseable');
    return parsed;
  }
}

Given('a host parser that builds the trees below', () => undefined);

Then('applet markup {string} parsed by the host has a frame: {word}', (_world: GuardWorld, markup: string, answer: string) => {
  const host = globalThis as { DOMParser?: unknown };
  host.DOMParser = FakeParser;
  try {
    expect(appletMarkupHasFrame(markup)).toBe(answer === 'yes');
  } finally {
    delete host.DOMParser;
  }
});

Then('asserting applet markup {string} has no frame passes', (_world: GuardWorld, markup: string) => {
  expect(() => assertAppletHasNoFrame(markup)).not.toThrow();
});

Then('asserting applet markup {string} has no frame is refused with {string}', (_world: GuardWorld, markup: string, reason: string) => {
  expect(() => assertAppletHasNoFrame(markup)).toThrow(reason);
});
