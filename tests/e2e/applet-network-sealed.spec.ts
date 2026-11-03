import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Request } from '@playwright/test';

/**
 * Proves in a real browser that an applet frame, built the way kernl builds it,
 * has no network of its own: the kehto prelude removes the peer-connection
 * globals and the guard's zero-network policy refuses every other way out.
 *
 * The spec does not use the served site. The host page is answered by a route on
 * an origin that does not exist, and any other request that reaches the network
 * layer is recorded and aborted, so it runs offline and under
 * `PLAYWRIGHT_BASE_URL` alike. It imports `test` from
 * Playwright rather than `./fixtures` because the policy reports each refused
 * attempt as a console error, which is the behaviour under test.
 */

const HOST_URL = 'https://kernl-host.test/';
const ROOT = resolve(import.meta.dirname, '../..');

/** Applet code that tries every way out it can and writes what happened into its own page. */
const APPLET_HTML = `<!doctype html>
<html><head><title>Escape</title></head>
<body>
<pre id="results">pending</pre>
<script>
const settle = (promise) => Promise.race([promise, new Promise((done) => setTimeout(() => done('timeout'), 1500))]);
const attempt = (body) => { try { return body(); } catch (error) { return 'threw ' + error.name; } };
const violations = [];
document.addEventListener('securitypolicyviolation', (event) => violations.push(event.effectiveDirective + ' ' + event.blockedURI));
(async () => {
  const results = {};
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
  results.nestedFrame = await settle(new Promise((done) => {
    const frame = document.createElement('iframe');
    frame.onload = () => done(attempt(() => frame.contentWindow.location.href));
    frame.src = 'https://example.com/frame';
    document.body.append(frame);
  }));
  results.beacon = attempt(() => navigator.sendBeacon('https://example.com/beacon', 'x'));
  await new Promise((done) => setTimeout(done, 300));
  results.violations = violations;
  document.getElementById('results').textContent = JSON.stringify(results);
})();
</script>
</body></html>`;

interface EscapeResults {
  fetch: string;
  webSocket: string;
  rtcPeerConnection: string;
  webkitRtcPeerConnection: string;
  rtcByName: string;
  rtcNamesSeen: number;
  rtcStillUsable: string[];
  rtcRestore: string;
  image: string;
  nestedFrame: string;
  beacon: boolean | string;
  violations: string[];
}

let hostHtml = '';

test.beforeAll(async () => {
  const core = (await import(pathToFileURL(resolve(ROOT, 'packages/core/dist/index.js')).href)) as typeof import('@kernl/core');
  const guard = (await import(pathToFileURL(resolve(ROOT, 'packages/guard/dist/index.js')).href)) as typeof import('@kernl/guard');
  const shell = (await import(pathToFileURL(resolve(ROOT, 'packages/core/node_modules/@kehto/shell/dist/index.js')).href)) as typeof import('@kehto/shell');
  const csp = guard.createAppletCsp('strict');
  const srcdoc = shell.prepareNappletSrcdoc(APPLET_HTML, {
    domains: ['shell'],
    csp: { connectOrigins: csp.connectOrigins, directives: csp.directives as import('@kehto/shell').NappletCspDirectives },
  });
  hostHtml = `<!doctype html>
<html><head>${core.KERNL_FRAME_POLICY_META}<title>Host</title></head>
<body>
<script>
const frame = document.createElement('iframe');
frame.setAttribute('sandbox', 'allow-scripts');
frame.srcdoc = ${JSON.stringify(srcdoc).replace(/</g, '\\u003c')};
document.body.append(frame);
</script>
</body></html>`;
});

test('an applet frame cannot reach the network on its own', async ({ page }) => {
  const outbound: string[] = [];
  const routed: string[] = [];
  const failed: string[] = [];
  page.on('request', (request: Request) => {
    if (request.url() !== HOST_URL) outbound.push(request.url());
  });
  await page.route('**/*', async (route) => {
    if (route.request().url() === HOST_URL) await route.fulfill({ contentType: 'text/html', body: hostHtml });
    else {
      routed.push(route.request().url());
      await route.abort();
    }
  });
  page.on('requestfailed', (request: Request) => failed.push(`${request.url()} ${request.failure()?.errorText}`));

  await page.goto(HOST_URL);
  const applet = page.frameLocator('iframe[sandbox="allow-scripts"]');
  await expect(applet.locator('#results')).not.toHaveText('pending', { timeout: 15_000 });
  const results = JSON.parse((await applet.locator('#results').textContent()) ?? '{}') as EscapeResults;

  expect(results.fetch).toMatch(/^failed/);
  expect(results.webSocket).not.toBe('opened');
  expect(results.rtcPeerConnection).toBe('undefined');
  expect(results.webkitRtcPeerConnection).toBe('undefined');
  expect(results.rtcByName).toBe('undefined');
  // The prelude does not delete the names: it pins each one to an undefined, read-only, non-configurable value.
  expect(results.rtcNamesSeen).toBeGreaterThan(0);
  expect(results.rtcStillUsable).toEqual([]);
  expect(results.rtcRestore).toBe('undefined');
  expect(results.image).toBe('failed');
  expect(results.nestedFrame).not.toMatch(/example\.com/);
  // sendBeacon only reports that the beacon was queued; the policy refuses it when it is sent.
  expect(typeof results.beacon).toBe('boolean');
  expect(results.violations).toEqual(
    expect.arrayContaining([
      'connect-src https://example.com/',
      'connect-src wss://example.com/',
      'img-src https://example.com/x.png',
      'frame-src https://example.com',
      'connect-src https://example.com/beacon',
    ]),
  );
  // Chromium reports a refused image as a request that failed with `csp`; it never reaches the network layer, which is where the route sits.
  expect(routed).toEqual([]);
  expect(failed).toEqual(outbound.map((url) => `${url} csp`));
});
