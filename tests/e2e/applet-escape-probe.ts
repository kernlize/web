/**
 * Applet code for `applet-network-sealed.spec.ts`: it tries every way out it
 * can and writes what happened into its own page. Kept apart from the spec so
 * the probe reads as one program.
 *
 * Every nested-frame route is attempted. A route that unexpectedly produces a
 * frame is attached, and its realm is searched for a peer connection that is
 * then used to gather candidates from a public STUN server.
 */
export const STUN_URL = 'stun:stun.l.google.com:19302';
/** Where the frame tries to send itself once the probe is done; the spec asserts no request for it reaches the network. */
export const NAVIGATE_URL = 'https://navigate.example.com/away';
/** The resource hints the probe adds, each to a host of its own. */
export const HINT_HOSTS = ['preconnect.example.com', 'dns-prefetch.example.com', 'prefetch.example.com'];

const FRAME_TAG = "'<ifr' + 'ame'";

/**
 * What a child frame runs if one is ever created: a child realm is
 * cross-origin to the applet, so it gathers candidates itself and reports
 * back by message.
 */
const CHILD_SRCDOC = `<script>
const Peer = window.RTCPeerConnection;
const report = (result) => parent.postMessage(Object.assign({ probe: 'child' }, result), '*');
if (typeof Peer !== 'function') report({ rtc: typeof Peer });
else {
  const types = [];
  const peer = new Peer({ iceServers: [{ urls: ${JSON.stringify(STUN_URL)} }] });
  peer.onicecandidate = (event) => (event.candidate ? types.push(event.candidate.type) : report({ rtc: 'function', types }));
  peer.createDataChannel('x');
  peer.createOffer().then((offer) => peer.setLocalDescription(offer));
  setTimeout(() => report({ rtc: 'function', types, timedOut: true }), 4000);
}
</script>`;

export const APPLET_HTML = `<!doctype html>
<html><head><title>Escape</title></head>
<body>
<pre id="results">pending</pre>
<script>
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const STUN = ${JSON.stringify(STUN_URL)};
const CHILD = ${JSON.stringify(CHILD_SRCDOC).replace(/</g, '\\u003c')};
const childReports = [];
window.addEventListener('message', (event) => { if (event.data && event.data.probe === 'child') childReports.push(event); });
const settle = (promise, ms = 1500) => Promise.race([promise, new Promise((done) => setTimeout(() => done('timeout'), ms))]);
const attempt = (body) => { try { return body(); } catch (error) { return 'threw ' + error.name + ': ' + error.message; } };
const violations = [];
document.addEventListener('securitypolicyviolation', (event) => violations.push(event.effectiveDirective + ' ' + event.blockedURI));

// document.write only parses while the document is still loading, so these run first.
const written = {
  whole: attempt(() => { document.write(${FRAME_TAG} + ' srcdoc="x"></ifr' + 'ame>'); return 'wrote'; }),
  split: attempt(() => { document.write('<ifr'); document.write('ame srcdoc="x">'); return 'wrote'; }),
};

function gather(Peer) {
  return settle(new Promise((done) => {
    const types = [];
    let peer;
    try {
      peer = new Peer({ iceServers: [{ urls: STUN }] });
    } catch (error) {
      done('threw ' + error.name);
      return;
    }
    peer.onicecandidate = (event) => {
      if (event.candidate) types.push(event.candidate.type);
      else done(types);
    };
    peer.createDataChannel('x');
    peer.createOffer().then((offer) => peer.setLocalDescription(offer)).catch((error) => done('failed ' + error.name));
  }), 5000);
}

async function probe(node) {
  if (!(node instanceof Node)) return 'no node';
  if (node instanceof HTMLIFrameElement) node.srcdoc = CHILD;
  const attached = attempt(() => { document.body.append(node); return 'attached'; });
  if (attached !== 'attached') return attached;
  const report = await settle(new Promise((done) => {
    const poll = setInterval(() => {
      const found = childReports.find((event) => event.source === node.contentWindow);
      if (found) { clearInterval(poll); done(found.data); }
    }, 50);
  }), 6000);
  if (report === 'timeout') return node.contentWindow ? 'attached, realm silent' : 'attached, no realm';
  return 'ESCAPED: ' + JSON.stringify(report);
}

async function route(build) {
  let node;
  const made = attempt(() => { node = build(); return 'created'; });
  return made === 'created' ? probe(node) : made;
}

const host = () => { const div = document.createElement('div'); document.body.append(div); return div; };

// A customized built-in: the element is minted by the parser's custom-element machinery, not by a factory.
const CustomFrame = attempt(() => {
  const Base = window['HTMLIF' + 'rameElement'];
  const Custom = class extends Base {};
  customElements.define('x-f', Custom, { extends: 'ifr' + 'ame' });
  return Custom;
});
// XSLT emits elements from its own engine. The stylesheet is built node by node, so no frame tag ever passes a string sink.
const xsltFrame = () => {
  const XSL = 'http://www.w3.org/1999/XSL/Transform';
  const sheet = document.implementation.createDocument(XSL, 'xsl:stylesheet', null);
  sheet.documentElement.setAttribute('version', '1.0');
  const template = sheet.createElementNS(XSL, 'xsl:template');
  template.setAttribute('match', '/');
  const element = sheet.createElementNS(XSL, 'xsl:element');
  element.setAttribute('name', 'ifr' + 'ame');
  element.setAttribute('namespace', HTML_NS);
  template.appendChild(element);
  sheet.documentElement.appendChild(template);
  const processor = new XSLTProcessor();
  processor.importStylesheet(sheet);
  const source = document.implementation.createDocument(null, 'x', null);
  return processor.transformToFragment(source, document).firstChild;
};
// An XHTML document with a prefixed element: the frame tag regex looks for '<' + 'ifr' + 'ame', not '<h:' + 'ifr' + 'ame'.
const xhtmlFrame = (adopt) => () => {
  const markup = '<div xmlns="' + HTML_NS + '" xmlns:h="' + HTML_NS + '"><h:ifr' + 'ame srcdoc="x"/></div>';
  const parsed = new DOMParser().parseFromString(markup, 'application/xhtml+xml');
  const frame = parsed.documentElement.firstElementChild;
  return adopt ? document.adoptNode(frame) : document.importNode(frame, true);
};
// Resource hints to hosts nothing else names, so any request the spec sees for them came from here.
const hint = (rel) => attempt(() => {
  const link = document.createElement('link');
  link.rel = rel;
  link.href = 'https://' + rel + '.example.com/hint';
  document.head.append(link);
  return 'added';
});
// Every insertion method the insertion lock guards, each given an unconnected frame obtained without a factory.
const looseFrame = () => {
  const markup = '<div xmlns="' + HTML_NS + '" xmlns:h="' + HTML_NS + '"><h:ifr' + 'ame srcdoc="x"/></div>';
  return document.importNode(new DOMParser().parseFromString(markup, 'application/xhtml+xml').documentElement.firstElementChild, true);
};
const inserted = (place) => {
  let frame;
  const made = attempt(() => { frame = looseFrame(); return 'created'; });
  if (made !== 'created') return made;
  if (frame instanceof HTMLIFrameElement) frame.srcdoc = CHILD;
  return attempt(() => { place(frame); return document.contains(frame) ? 'ESCAPED: connected' : 'not connected'; });
};
const imported = (markup, adopt) => () => {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  const frame = parsed.body.firstElementChild;
  return adopt ? document.adoptNode(frame) : document.importNode(frame, true);
};

(async () => {
  const results = { written };
  results.frames = {
    createElement: await route(() => document.createElement('iframe')),
    createElementUpper: await route(() => document.createElement('IFRAME')),
    createElementNS: await route(() => document.createElementNS(HTML_NS, 'iframe')),
    innerHTML: await route(() => { const div = host(); div.innerHTML = ${FRAME_TAG} + ' srcdoc="<p>x</p>"></ifr' + 'ame>'; return div.firstElementChild; }),
    outerHTML: await route(() => { const div = host().appendChild(document.createElement('span')); div.outerHTML = ${FRAME_TAG} + ' srcdoc="x">'; return document.body.querySelector('iframe'); }),
    insertAdjacentHTML: await route(() => { const div = host(); div.insertAdjacentHTML('beforeend', ${FRAME_TAG} + ' srcdoc="x">'); return div.firstElementChild; }),
    contextualFragment: await route(() => document.createRange().createContextualFragment(${FRAME_TAG} + ' srcdoc="x">').firstChild),
    domParserImportNode: await route(imported(${FRAME_TAG} + ' srcdoc="x">', false)),
    domParserAdoptNode: await route(imported(${FRAME_TAG} + ' srcdoc="x">', true)),
    createDocument: await route(() => document.adoptNode(document.implementation.createDocument(HTML_NS, 'iframe', null).documentElement)),
    createHTMLDocument: await route(() => document.adoptNode(document.implementation.createHTMLDocument('x').createElement('iframe'))),
    object: await route(() => document.createElement('object')),
    embed: await route(() => document.createElement('embed')),
    objectMarkup: await route(() => { const div = host(); div.innerHTML = '<obj' + 'ect data="x"></obj' + 'ect>'; return div.firstElementChild; }),
    embedMarkup: await route(() => { const div = host(); div.innerHTML = '<emb' + 'ed src="x">'; return div.firstElementChild; }),
  };
  results.moreFrames = {
    customizedBuiltInConstructor: typeof CustomFrame === 'function' ? await route(() => new CustomFrame()) : CustomFrame,
    customizedBuiltInCreateElement: await route(() => document.createElement('ifr' + 'ame', { is: 'x-f' })),
    xsltTransformToFragment: await route(xsltFrame),
    xhtmlPrefixedImportNode: await route(xhtmlFrame(false)),
    xhtmlPrefixedAdoptNode: await route(xhtmlFrame(true)),
  };
  results.insertions = {
    insertBefore: inserted((f) => document.body.insertBefore(f, null)),
    replaceChild: inserted((f) => { const old = host(); document.body.replaceChild(f, old); }),
    prepend: inserted((f) => host().prepend(f)),
    replaceChildren: inserted((f) => host().replaceChildren(f)),
    textBefore: inserted((f) => { const text = document.createTextNode('t'); host().append(text); text.before(f); }),
    commentAfter: inserted((f) => { const note = document.createComment('c'); host().append(note); note.after(f); }),
    replaceWith: inserted((f) => host().replaceWith(f)),
    insertAdjacentElement: inserted((f) => host().insertAdjacentElement('beforeend', f)),
    rangeInsertNode: inserted((f) => { const range = document.createRange(); range.selectNodeContents(host()); range.insertNode(f); }),
    rangeSurroundContents: inserted((f) => { const range = document.createRange(); range.selectNodeContents(host()); range.surroundContents(f); }),
    shadowRoot: inserted((f) => host().attachShadow({ mode: 'open' }).appendChild(f)),
    fragmentThenAppend: inserted((f) => { const fragment = document.createDocumentFragment(); fragment.append(f); document.body.append(fragment); }),
    moveBefore: inserted((f) => { const box = host(); if (typeof box.moveBefore !== 'function') throw new TypeError('unsupported'); box.moveBefore(f, null); }),
  };
  results.hints = { preconnect: hint('preconnect'), dnsPrefetch: hint('dns-prefetch'), prefetch: hint('prefetch') };
  await new Promise((done) => setTimeout(done, 500));
  results.childRealms = window.frames.length;
  results.childReports = childReports.map((event) => event.data);
  results.topPeer = typeof RTCPeerConnection;
  results.topGather = await gather(window.RTCPeerConnection || function () { throw new TypeError('no RTCPeerConnection'); });
  results.ordinaryMarkup = attempt(() => { const div = host(); div.innerHTML = '<p class="ok">plain</p>'; return div.querySelector('.ok') ? 'rendered' : 'missing'; });

  results.fetch = await settle(fetch('https://example.com/').then(() => 'answered', (error) => 'failed ' + error.name));
  results.webSocket = await settle(new Promise((done) => {
    try {
      const socket = new WebSocket('wss://example.com/');
      socket.onopen = () => done('opened');
      socket.onerror = () => done('failed');
    } catch (error) {
      done('threw ' + error.name);
    }
  }));
  results.rtcPeerConnection = typeof RTCPeerConnection;
  results.webkitRtcPeerConnection = typeof webkitRTCPeerConnection;
  results.rtcByName = typeof globalThis['RTC' + 'PeerConnection'];
  const rtcNames = Object.getOwnPropertyNames(globalThis).filter((name) => /RTC/.test(name));
  results.rtcNamesSeen = rtcNames.length;
  results.rtcStillUsable = rtcNames.filter((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    return globalThis[name] !== undefined || descriptor.configurable || descriptor.writable;
  });
  results.rtcRestore = attempt(() => { delete globalThis.RTCPeerConnection; return typeof globalThis.RTCPeerConnection; });
  results.image = await settle(new Promise((done) => {
    const image = document.createElement('img');
    image.onload = () => done('loaded');
    image.onerror = () => done('failed');
    image.src = 'https://example.com/x.png';
    document.body.append(image);
  }));
  results.beacon = attempt(() => navigator.sendBeacon('https://example.com/beacon', 'x'));
  await new Promise((done) => setTimeout(done, 300));
  results.violations = violations;
  document.getElementById('results').textContent = JSON.stringify(results);
})();
// Last, once the spec has read the results and asks: the frame tries to navigate itself away from its verified bytes.
window.addEventListener('message', (event) => {
  if (event.data === 'navigate') attempt(() => { location.href = ${JSON.stringify(NAVIGATE_URL)}; });
});
</script>
</body></html>`;

/** What the probe reports. */
export interface EscapeResults {
  written: { whole: string; split: string };
  frames: Record<string, string>;
  moreFrames: Record<string, string>;
  insertions: Record<string, string>;
  hints: Record<string, string>;
  childRealms: number;
  childReports: Array<{ rtc: string; types?: string[] }>;
  topPeer: string;
  topGather: string | string[];
  ordinaryMarkup: string;
  fetch: string;
  webSocket: string;
  rtcPeerConnection: string;
  webkitRtcPeerConnection: string;
  rtcByName: string;
  rtcNamesSeen: number;
  rtcStillUsable: string[];
  rtcRestore: string;
  image: string;
  beacon: boolean | string;
  violations: string[];
}
