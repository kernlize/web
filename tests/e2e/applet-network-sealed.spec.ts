import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Request } from '@playwright/test';
import { APPLET_HTML, HINT_HOSTS, NAVIGATE_URL, STUN_URL, type EscapeResults } from './applet-escape-probe.js';

/**
 * Proves in a real browser that an applet frame, built by kernl's own
 * `planMount`, has no network of its own: the kehto prelude removes the
 * peer-connection globals, kehto's nested-context lock (enabled by the plan)
 * refuses every way to create a child frame whose fresh realm would still have
 * them, kernl's insertion lock (D-014) refuses connecting one that slipped past
 * creation, and the guard's
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
 *
 * The host page mounts the frame with kernl's own `mountApplet`, bundled from
 * the built core for the browser: an empty frame is attached first, then
 * `mountApplet` hardens it (sandbox replaced with exactly `allow-scripts`, the
 * controller-deny allow policy) and only then assigns `srcdoc`. The bridge and
 * origin registry are inert stand-ins; they only observe, and the sealing under
 * test does not depend on them.
 */

const HOST_URL = 'https://kernl-host.test/';
const ROOT = resolve(import.meta.dirname, '../..');
/** Creation routes meet kehto's Trusted Types policy and factory pins. */
const KEHTO_DENIED = 'threw TypeError: kehto: napplets may not create nested browsing contexts';
/** Insertion routes meet kernl's insertion lock. */
const KERNL_DENIED = 'threw TypeError: denied:nested-frame';

/** What each of the further frame routes must come to: refused, unsupported by this browser, or a node that never became a frame. */
const MORE_FRAME_OUTCOMES: Record<string, RegExp> = {
  customizedBuiltInConstructor: /^threw /,
  customizedBuiltInCreateElement: /^threw /,
  xsltTransformToFragment: /^(threw |no node$)/,
  xhtmlPrefixedImportNode: /^(threw |no node$)/,
  xhtmlPrefixedAdoptNode: /^(threw |no node$)/,
};

/** Every insertion route must be refused by the insertion lock, or be unsupported by the browser. */
const INSERTION_OUTCOME = new RegExp(`^(${KERNL_DENIED}|threw TypeError: unsupported)$`);

type Core = typeof import('@kernlize/core');
type AppletSummary = import('@kernlize/core').AppletSummary;

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

/** `mountApplet` from the built core, bundled for the browser with esbuild (a root devDependency). */
async function bundleMount(): Promise<string> {
  const { build } = await import('esbuild');
  const entry = `export { mountApplet } from ${JSON.stringify(resolve(ROOT, 'packages/core/dist/index.js'))};`;
  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'js' },
    bundle: true,
    format: 'iife',
    globalName: 'kernlMount',
    platform: 'browser',
    logLevel: 'error',
    write: false,
  });
  return (result.outputFiles[0]?.text ?? '').replace(/<\/script/gi, '<\\/script');
}

test.beforeAll(async () => {
  core = (await import(pathToFileURL(resolve(ROOT, 'packages/core/dist/index.js')).href)) as Core;
  const mountPlan = plan(APPLET_HTML);
  const mountBundle = await bundleMount();
  hostHtml = `<!doctype html>
<html><head>${core.KERNL_FRAME_POLICY_META}<title>Host</title></head>
<body>
<script>${mountBundle}</script>
<script>
window.control = new Promise((done) => {
  const types = [];
  const peer = new RTCPeerConnection({ iceServers: [{ urls: ${JSON.stringify(STUN_URL)} }] });
  peer.onicecandidate = (event) => (event.candidate ? types.push(event.candidate.type) : done(types));
  peer.createDataChannel('control');
  peer.createOffer().then((offer) => peer.setLocalDescription(offer));
  setTimeout(() => done(types), 5000);
});
const plan = ${JSON.stringify(mountPlan).replace(/</g, '\\u003c')};
const frame = document.createElement('iframe');
document.body.append(frame);
const noop = () => {};
window.mounted = kernlMount.mountApplet(plan, frame, {
  bridge: { observeFrame: () => noop, revokeNapplet: noop },
  originRegistry: { register: noop, setEnvironment: noop, unregister: noop },
  guard: { setVisibility: noop, forget: noop },
});
window.hardened = { sandbox: frame.getAttribute('sandbox'), allow: frame.getAttribute('allow') };
</script>
</body></html>`;
});

test('planMount refuses applet markup that declares a frame of its own', () => {
  for (const markup of ['<iframe srcdoc="x"></iframe>', '<object data="x"></object>', '<embed src="x">', '<frameset></frameset>']) {
    expect(() => plan(`<!doctype html><html><body>${markup}</body></html>`), markup).toThrow('denied:nested-frame');
  }
});

test('the insertion lock runs after the kehto prelude and before the applet script', () => {
  const { srcdoc } = plan(APPLET_HTML);
  const order = ['<meta http-equiv="Content-Security-Policy"', '<script data-kehto-nip5d-injection>', '<script data-kernl-insertion-lock>', '<pre id="results">'].map((marker) => srcdoc.indexOf(marker));
  expect(order.every((at) => at >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(srcdoc).toContain("frame-src 'none'; media-src 'none'");
  expect(srcdoc).toContain("; require-trusted-types-for 'script'; trusted-types default\">");
});

test('an applet frame cannot reach the network on its own, directly or through a child frame', async ({ page }) => {
  test.setTimeout(90_000);
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
  await expect(applet.locator('#results')).not.toHaveText('pending', { timeout: 60_000 });
  const results = JSON.parse((await applet.locator('#results').textContent()) ?? '{}') as EscapeResults;
  const control = (await page.evaluate(() => (window as unknown as { control: Promise<string[]> }).control)) as string[];
  const stunReachable = control.includes('srflx');
  test.info().annotations.push({ type: 'stun', description: stunReachable ? 'reachable from the host page' : 'unreachable from the host page; the candidate checks were skipped' });
  test.info().annotations.push({ type: 'frames', description: JSON.stringify({ written: results.written, ...results.frames, ...results.moreFrames }) });
  test.info().annotations.push({ type: 'hints', description: JSON.stringify(results.hints) });

  const hardened = await page.evaluate(() => (window as unknown as { hardened: { sandbox: string; allow: string } }).hardened);
  expect(hardened.sandbox).toBe('allow-scripts');
  expect(hardened.allow).toBe(core.CONTROLLER_DENY_POLICY);

  expect(results.written).toEqual({ whole: KEHTO_DENIED, split: KEHTO_DENIED });
  for (const [routeName, outcome] of Object.entries(results.frames)) expect(outcome, routeName).toBe(KEHTO_DENIED);
  expect(Object.keys(results.frames)).toHaveLength(15);
  // Soft, so one escaped route still lets every other check below report.
  expect(Object.keys(results.moreFrames).sort()).toEqual(Object.keys(MORE_FRAME_OUTCOMES).sort());
  for (const [routeName, outcome] of Object.entries(results.moreFrames)) expect.soft(outcome, routeName).toMatch(MORE_FRAME_OUTCOMES[routeName] ?? /^never$/);
  expect(Object.keys(results.insertions).length).toBeGreaterThanOrEqual(13);
  for (const [routeName, outcome] of Object.entries(results.insertions)) expect.soft(outcome, routeName).toMatch(INSERTION_OUTCOME);
  expect.soft(results.childRealms, 'child frames that came to exist').toBe(0);
  expect.soft(results.childReports, 'child frames that reported back').toEqual([]);
  expect(results.topPeer).toBe('undefined');
  expect(results.topGather).toMatch(/^threw TypeError/);
  for (const outcome of [...Object.values(results.frames), ...Object.values(results.moreFrames), ...Object.values(results.insertions), JSON.stringify(results.topGather)]) expect.soft(outcome).not.toMatch(/srflx|relay|ESCAPED/);
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
  // Now that the results are read, the frame is asked to navigate itself; give the attempt time to reach the network if it can.
  await page.evaluate(() => window.frames[0]?.postMessage('navigate', '*'));
  await page.waitForTimeout(1500);
  const appletFrame = page.frames().find((frame) => frame !== page.mainFrame());
  expect(appletFrame?.url() ?? '', 'the frame did not land on the address it asked for').not.toContain(new URL(NAVIGATE_URL).host);
  // Chromium reports a refused image as a request that failed with `csp`; it never reaches the network layer, which is where the route sits.
  expect(routed).toEqual([]);
  expect(outbound.filter((url) => url.startsWith(NAVIGATE_URL)), 'self-navigation').toEqual([]);
  // Preconnect and DNS prefetch never become requests; a prefetch does, and the policy refuses it like the image (the `csp` check below).
  const [preconnect, dnsPrefetch] = HINT_HOSTS;
  expect(outbound.filter((url) => url.includes(`//${preconnect}`) || url.includes(`//${dnsPrefetch}`)), 'connection hints').toEqual([]);
  expect(routed.filter((url) => HINT_HOSTS.some((hintHost) => url.includes(hintHost))), 'resource hints that reached the network').toEqual([]);
  expect(failed).toEqual(outbound.map((url) => `${url} csp`));

  // The control: candidate gathering only proves something when the host page itself reaches STUN.
  test.skip(!stunReachable, 'The host page could not reach the public STUN server, so absent candidates prove nothing about the frame.');
  expect(stunReachable).toBe(true);
  expect(results.childReports.flatMap((report) => report.types ?? [])).toEqual([]);
  expect(Array.isArray(results.topGather) ? results.topGather : []).not.toContain('srflx');
});
