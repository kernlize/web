import { expect } from 'vitest';
import { Given, Then, When } from 'quickpickle';
import {
  DEFAULT_HTTP_POLICY,
  createHttpBridge,
  isBlockedHostname,
  isPrivateAddress,
  parseLocator,
  type HttpBridgeOptions,
  type HttpPolicy,
} from '@kernlize/bridges';
import { capture, expectReason, splitList, type BridgeWorld, type FakeServer } from './world';

function createServer(): FakeServer {
  return {
    redirects: new Map(),
    requests: [],
    answer: () => new Response('ok', { headers: { 'x-served-by': 'fake' } }),
    mode: 'answer',
    failure: undefined,
  };
}

function fakeFetch(server: FakeServer): typeof fetch {
  return (input, init = {}) => {
    const url = String(input);
    server.requests.push({ url, init });
    if (server.mode === 'fail') return Promise.reject(server.failure);
    if (server.mode === 'hang') {
      return new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (!signal) return;
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    }
    const location = server.redirects.get(url);
    if (location === undefined) return Promise.resolve(server.answer());
    return Promise.resolve(new Response(null, { status: 302, headers: location ? { location } : {} }));
  };
}

function startBridge(world: BridgeWorld, policy: Partial<HttpPolicy> = {}, extra: Partial<HttpBridgeOptions> = {}): void {
  world.server = createServer();
  world.webBridge = createHttpBridge({ policy, fetch: fakeFetch(world.server), ...extra });
}

function server(world: BridgeWorld): FakeServer {
  if (!world.server) throw new Error('no fake server');
  return world.server;
}

function webBridge(world: BridgeWorld) {
  if (!world.webBridge) throw new Error('no web bridge');
  return world.webBridge;
}

function chunkedBody(chunks: number, size: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent === chunks) controller.close();
      else {
        sent += 1;
        controller.enqueue(new Uint8Array(size));
      }
    },
  });
}

Then('the default web policy allows only {string}', (_world: BridgeWorld, scheme: string) => {
  expect(DEFAULT_HTTP_POLICY.allowedSchemes).toEqual([scheme]);
  expect(DEFAULT_HTTP_POLICY.allowPrivateHosts).toEqual([]);
});

Then(
  'the default web policy caps redirects at {int}, bytes at {int} and time at {int} ms',
  (_world: BridgeWorld, redirects: number, bytes: number, time: number) => {
    expect(DEFAULT_HTTP_POLICY).toMatchObject({ maxRedirects: redirects, maxBytes: bytes, timeoutMs: time });
  },
);

Then('the address {string} is blocked', (_world: BridgeWorld, ip: string) => {
  expect(isPrivateAddress(ip)).toBe(true);
});

Then('the address {string} is allowed', (_world: BridgeWorld, ip: string) => {
  expect(isPrivateAddress(ip)).toBe(false);
});

Then('the hostname {string} is blocked', (_world: BridgeWorld, host: string) => {
  expect(isBlockedHostname(host)).toBe(true);
});

Then('the hostname {string} is allowed', (_world: BridgeWorld, host: string) => {
  expect(isBlockedHostname(host)).toBe(false);
});

Given('a web bridge', (world: BridgeWorld) => {
  startBridge(world);
});

Given('a web bridge allowing {string}', (world: BridgeWorld, schemes: string) => {
  startBridge(world, { allowedSchemes: splitList(schemes) });
});

Given('a web bridge whose resolver maps {string} to {string}', (world: BridgeWorld, host: string, ip: string) => {
  startBridge(world, {}, { resolveHost: async (name) => (name === host ? [ip] : []) });
});

Given('a web bridge allowing private host {string}', (world: BridgeWorld, host: string) => {
  startBridge(world, { allowPrivateHosts: [host] }, { resolveHost: async () => ['10.0.0.5'] });
});

Given('a web bridge with the platform fetch', (world: BridgeWorld) => {
  world.server = createServer();
  world.webBridge = createHttpBridge();
});

Given('a web bridge capped at {int} redirect(s)', (world: BridgeWorld, maxRedirects: number) => {
  startBridge(world, { maxRedirects });
});

Given('a web bridge capped at {int} bytes', (world: BridgeWorld, maxBytes: number) => {
  startBridge(world, { maxBytes });
});

Given('a web bridge with a {int} ms time limit', (world: BridgeWorld, timeoutMs: number) => {
  startBridge(world, { timeoutMs });
});

Given('the server redirects {string} to {string}', (world: BridgeWorld, from: string, location: string) => {
  server(world).redirects.set(from, location);
});

Given('the server never answers', (world: BridgeWorld) => {
  server(world).mode = 'hang';
});

Given('the server fails with {string}', (world: BridgeWorld, message: string) => {
  const fake = server(world);
  fake.mode = 'fail';
  fake.failure = new Error(message);
});

/** What a browser's fetch returns for status-0 answers; `Response` cannot be constructed with status 0, so the getters are shadowed. */
function statusZero(type: ResponseType): Response {
  const response = new Response(null);
  Object.defineProperties(response, { type: { value: type }, status: { value: 0 }, ok: { value: false } });
  return response;
}

Given('the server answers with a redirect the browser hides', (world: BridgeWorld) => {
  server(world).answer = () => statusZero('opaqueredirect');
});

Given('the server answers with an opaque response', (world: BridgeWorld) => {
  server(world).answer = () => statusZero('opaque');
});

Given('the browser blocks the request with {string}', (world: BridgeWorld, message: string) => {
  const fake = server(world);
  fake.mode = 'fail';
  fake.failure = new TypeError(message);
});

Given('the server fails with a bare string', (world: BridgeWorld) => {
  const fake = server(world);
  fake.mode = 'fail';
  fake.failure = 'boom';
});

Given('the server declares a content length of {int}', (world: BridgeWorld, length: number) => {
  server(world).answer = () => new Response('x', { headers: { 'content-length': String(length) } });
});

Given('the server answers with {int} chunks of {int} bytes', (world: BridgeWorld, chunks: number, size: number) => {
  server(world).answer = () => new Response(chunkedBody(chunks, size), { headers: { 'x-served-by': 'fake' } });
});

Given('the server answers {int} with no body', (world: BridgeWorld, status: number) => {
  server(world).answer = () => new Response(null, { status });
});

Then('the web bridge serves {string}', (world: BridgeWorld, schemes: string) => {
  expect(webBridge(world).schemes).toEqual(splitList(schemes));
});

Then('the web bridge is encrypted in transit', (world: BridgeWorld) => {
  expect(webBridge(world).exposure.encryptedInTransit).toBe(true);
});

Then('the web bridge is not encrypted in transit', (world: BridgeWorld) => {
  expect(webBridge(world).exposure.encryptedInTransit).toBe(false);
});

Then('the web bridge is available', (world: BridgeWorld) => {
  expect(webBridge(world).availability()).toEqual({ available: true });
});

Then('the web bridge is labelled {string} with id {string}', (world: BridgeWorld, label: string, id: string) => {
  expect(webBridge(world)).toMatchObject({ id, label });
});

Then('the web bridge reveals the address, is not public activity', (world: BridgeWorld) => {
  expect(webBridge(world).exposure).toMatchObject({ revealsAddress: true, publicActivity: false });
});

When('the web bridge resolves {string}', async (world: BridgeWorld, url: string) => {
  await capture(world, () => webBridge(world).resolve(parseLocator(url), { requester: 'shell' }));
});

When('the web bridge resolves {string} and the caller cancels', async (world: BridgeWorld, url: string) => {
  const controller = new AbortController();
  const pending = capture(world, () =>
    webBridge(world).resolve(parseLocator(url), { requester: 'shell', signal: controller.signal }),
  );
  controller.abort();
  await pending;
});

When(
  'the web bridge resolves {string} with header {string} set to {string}',
  async (world: BridgeWorld, url: string, name: string, value: string) => {
    const context = { requester: 'shell' as const, headers: { [name]: value } };
    await capture(world, () => webBridge(world).resolve(parseLocator(url), context));
  },
);

Then('the web request fails with {string}', (world: BridgeWorld, reason: string) => {
  expectReason(world.error, reason);
});

Then('no request was sent', (world: BridgeWorld) => {
  expect(server(world).requests).toHaveLength(0);
});

Then('{int} request(s) was/were sent', (world: BridgeWorld, count: number) => {
  expect(server(world).requests).toHaveLength(count);
});

Then('every request asked for manual redirects', (world: BridgeWorld) => {
  expect(server(world).requests.every((request) => request.init.redirect === 'manual')).toBe(true);
});

Then('the last request was for {string}', (world: BridgeWorld, url: string) => {
  expect(server(world).requests.at(-1)?.url).toBe(url);
});

Then('the last request carried header {string} set to {string}', (world: BridgeWorld, name: string, value: string) => {
  expect(server(world).requests.at(-1)?.init.headers).toEqual({ [name]: value });
});

Then('the web response status is {int}', (world: BridgeWorld, status: number) => {
  expect(world.error).toBeUndefined();
  expect(world.result).toMatchObject({ kind: 'bytes' });
  if (world.result?.kind === 'bytes') expect(world.result.response.status).toBe(status);
});

Then('the web response header {string} is {string}', (world: BridgeWorld, name: string, value: string) => {
  if (world.result?.kind === 'bytes') expect(world.result.response.headers.get(name)).toBe(value);
});

Then('the web response has no body', (world: BridgeWorld) => {
  if (world.result?.kind === 'bytes') expect(world.result.response.body).toBeNull();
});

Then('reading the web response yields {int} bytes', async (world: BridgeWorld, bytes: number) => {
  if (world.result?.kind === 'bytes') expect((await world.result.response.arrayBuffer()).byteLength).toBe(bytes);
});

Then('reading the web response fails with {string}', async (world: BridgeWorld, reason: string) => {
  if (world.result?.kind === 'bytes') {
    const error = await world.result.response.arrayBuffer().then(() => undefined, (cause: unknown) => cause);
    expectReason(error, reason);
  }
});
