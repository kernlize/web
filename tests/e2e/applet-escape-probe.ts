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
  document.body.append(node);
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
</script>
</body></html>`;

/** What the probe reports. */
export interface EscapeResults {
  written: { whole: string; split: string };
  frames: Record<string, string>;
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
