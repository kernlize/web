import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Request } from '@playwright/test';
import { APPLET_HTML, STUN_URL, type EscapeResults } from './applet-escape-probe.js';

/**
 * Proves in a real browser that an applet frame, built by kernl's own
 * `planMount`, has no network of its own: the kehto prelude removes the
 * peer-connection globals, kernl's frame lock (D-014) refuses every way to
 * open a child frame whose fresh realm would still have them, and the guard's
 * zero-network policy refuses every other way out.
 *
 * The spec does not use the served site. The host page is answered by a route on
 * an origin that does not exist, and any other request that reaches the network
 * layer is recorded and aborted, so it runs offline and under
 * `PLAYWRIGHT_BASE_URL` alike. Peer connections speak UDP, which no route sees,
 * so the host page gathers candidates from a public STUN server as a control:
 * when it reaches one, the applet's lack of candidates is evidence and not an
 * artefact of the network. It imports `test` from Playwright rather than
 * `./fixtures` because the policy reports each refused attempt as a console
 * error, which is the behaviour under test.
 */

const HOST_URL = 'https://kernl-host.test/';
const ROOT = resolve(import.meta.dirname, '../..');
const DENIED = 'threw TypeError: denied:nested-frame';

type Core = typeof import('@kernl/core');
type AppletSummary = import('@kernl/core').AppletSummary;

let core: Core;
let hostHtml = '';

/** Exactly what `planMount` reads from an adapter: the grants narrow the environment to the handshake. */
const adapter = { capabilities: { resolveEnvironment: () => ({ domains: ['shell'], services: [] }) } };

function summaryFor(dTag: string): AppletSummary {
  return { identity: { dTag, hash: 'ab'.repeat(32), pubkey: 'cd'.repeat(32) }, requires: [] } as unknown as AppletSummary;
}

function plan(indexHtml: string) {
  return core.planMount({ summary: summaryFor('escape'), indexHtml, adapter: adapter as never, guardProfile: 'strict', windowId: 'escape-1' });
}

test.beforeAll(async () => {
  core = (await import(pathToFileURL(resolve(ROOT, 'packages/core/dist/index.js')).href)) as Core;
  const { srcdoc, sandbox } = plan(APPLET_HTML);
  hostHtml = `<!doctype html>
<html><head>${core.KERNL_FRAME_POLICY_META}<title>Host</title></head>
<body>
<script>
window.control = new Promise((done) => {
  const types = [];
  const peer = new RTCPeerConnection({ iceServers: [{ urls: ${JSON.stringify(STUN_URL)} }] });
  peer.onicecandidate = (event) => (event.candidate ? types.push(event.candidate.type) : done(types));
  peer.createDataChannel('control');
  peer.createOffer().then((offer) => peer.setLocalDescription(offer));
  setTimeout(() => done(types), 5000);
});
const frame = document.createElement('iframe');
frame.setAttribute('sandbox', ${JSON.stringify(sandbox)});
frame.srcdoc = ${JSON.stringify(srcdoc).replace(/</g, '\\u003c')};
document.body.append(frame);
</script>
</body></html>`;
});

test('planMount refuses applet markup that declares a frame of its own', () => {
  for (const markup of ['<iframe srcdoc="x"></iframe>', '<object data="x"></object>', '<embed src="x">', '<frameset></frameset>']) {
    expect(() => plan(`<!doctype html><html><body>${markup}</body></html>`), markup).toThrow('denied:nested-frame');
  }
});

test('the frame lock runs after the kehto prelude and before the applet script', () => {
  const { srcdoc } = plan(APPLET_HTML);
  const order = ['<meta http-equiv="Content-Security-Policy"', '<script data-kehto-nip5d-injection>', '<script data-kernl-frame-lock>', '<pre id="results">'].map((marker) => srcdoc.indexOf(marker));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(srcdoc).toContain("frame-src 'none'; media-src 'none'");
  expect(srcdoc).toContain("; require-trusted-types-for 'script'; trusted-types default\">");
});

test('an applet frame cannot reach the network on its own, directly or through a child frame', async ({ page }) => {
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
  await expect(applet.locator('#results')).not.toHaveText('pending', { timeout: 30_000 });
  const results = JSON.parse((await applet.locator('#results').textContent()) ?? '{}') as EscapeResults;
  const control = (await page.evaluate(() => (window as unknown as { control: Promise<string[]> }).control)) as string[];
  const stunReachable = control.includes('srflx');
  test.info().annotations.push({ type: 'stun', description: stunReachable ? 'reachable from the host page' : 'unreachable; candidate checks rest on absent constructors' });
  test.info().annotations.push({ type: 'frames', description: JSON.stringify({ written: results.written, ...results.frames }) });

  expect(results.written).toEqual({ whole: DENIED, split: DENIED });
  for (const [routeName, outcome] of Object.entries(results.frames)) expect(outcome, routeName).toBe(DENIED);
  expect(Object.keys(results.frames)).toHaveLength(15);
  expect(results.childRealms).toBe(0);
  expect(results.childReports).toEqual([]);
  expect(results.topPeer).toBe('undefined');
  expect(results.topGather).toMatch(/^threw TypeError/);
  for (const outcome of [...Object.values(results.frames), JSON.stringify(results.topGather)]) expect(outcome).not.toMatch(/srflx|relay|ESCAPED/);
  expect(results.ordinaryMarkup).toBe('rendered');

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
  // sendBeacon only reports that the beacon was queued; the policy refuses it when it is sent.
  expect(typeof results.beacon).toBe('boolean');
  expect(results.violations).toEqual(
    expect.arrayContaining([
      'connect-src https://example.com/',
      'connect-src wss://example.com/',
      'img-src https://example.com/x.png',
      'connect-src https://example.com/beacon',
    ]),
  );
  // Chromium reports a refused image as a request that failed with `csp`; it never reaches the network layer, which is where the route sits.
  expect(routed).toEqual([]);
  expect(failed).toEqual(outbound.map((url) => `${url} csp`));
});
