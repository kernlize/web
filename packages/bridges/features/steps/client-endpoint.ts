import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';
import { After, Given, Then, When } from 'quickpickle';
import { checkClientEndpoint, detectClientEndpoint, endpointCandidates, type EndpointCheck, type PageScheme } from '../../src/clients/endpoint';
import { clientError, readClientJson, requestClient } from '../../src/clients/http';
import { expectReason, splitList } from './world';

type Behaviour = 'the program' | 'some other program' | 'refusing';

interface Port {
  readonly server: Server;
  url: string;
  behaviour: Behaviour;
}

interface Detected {
  readonly endpoint: Extract<EndpointCheck, { ok: true }>;
  readonly result: string;
}

interface EndpointWorld {
  endpointCheck?: EndpointCheck;
  endpointPorts?: Record<PageScheme, Port>;
  endpointAsked?: string[];
  endpointDetected?: Detected;
  endpointError?: unknown;
}

async function listen(name: string): Promise<Port> {
  const port: Port = {
    behaviour: 'the program',
    url: '',
    server: createServer((_request, response) => {
      if (port.behaviour === 'refusing') response.writeHead(401).end();
      else if (port.behaviour === 'some other program') response.writeHead(404, { 'content-type': 'text/html' }).end('<h1>Not here</h1>');
      else response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ port: name }));
    }),
  };
  await new Promise<void>((resolve) => port.server.listen(0, '127.0.0.1', resolve));
  port.url = `http://127.0.0.1:${(port.server.address() as AddressInfo).port}`;
  return port;
}

function close(port: Port): Promise<void> {
  return new Promise((resolve) => {
    port.server.close(() => resolve());
    port.server.closeAllConnections();
  });
}

function ports(world: EndpointWorld): Record<PageScheme, Port> {
  if (!world.endpointPorts) throw new Error('no loopback programs');
  return world.endpointPorts;
}

/**
 * The probe a settings screen would pass: one real request for the program's version.
 * A typed name such as `nas.local` cannot be resolved in a test, and a loopback server
 * has no certificate, so the request for each candidate goes to the loopback server
 * standing in for that candidate's port; everything else is the real path.
 */
function probeFor(world: EndpointWorld): (url: string) => Promise<string> {
  return async (url) => {
    (world.endpointAsked ??= []).push(url);
    const port = ports(world)[url.startsWith('https:') ? 'https' : 'http'];
    const response = await requestClient({ endpoint: { url: port.url } }, `${port.url}/api/version`);
    if (!response.ok) throw clientError('unavailable:bad-response', 'not the program');
    return ((await readClientJson(response)) as { port: string }).port;
  };
}

const NAMES: Record<string, PageScheme> = { encrypted: 'https', plain: 'http' };

function named(world: EndpointWorld, name: string): Port {
  return ports(world)[NAMES[name] as PageScheme];
}

After(async (world: EndpointWorld) => {
  if (world.endpointPorts) await Promise.all(Object.values(world.endpointPorts).map(close));
});

When('the client address {string} is checked for a page loaded over {word}', (world: EndpointWorld, typed: string, page: string) => {
  world.endpointCheck = checkClientEndpoint(typed, page as PageScheme);
});

Then('the client address check allows {string} on {} with notes {string}', (world: EndpointWorld, url: string, where: string, notes: string) => {
  expect(world.endpointCheck).toEqual({ ok: true, url, scheme: url.startsWith('https:') ? 'https' : 'http', loopback: where === 'this device', notes: splitList(notes) });
});

Then('the client address check refuses with {string}', (world: EndpointWorld, reason: string) => {
  expect(world.endpointCheck).toEqual({ ok: false, reason });
});

Then('the client addresses to try for {string} on a page loaded over {word} are {string}', (_world: EndpointWorld, typed: string, page: string, expected: string) => {
  const candidates = endpointCandidates(typed, page as PageScheme);
  expect(candidates.map((check) => (check.ok ? check.url : check.reason))).toEqual(splitList(expected));
});

Given('two loopback programs stand in for the encrypted and the plain port of a typed client address', async (world: EndpointWorld) => {
  world.endpointPorts = { https: await listen('encrypted'), http: await listen('plain') };
  world.endpointAsked = [];
});

Given('the {word} client port answers as the program', (world: EndpointWorld, name: string) => {
  named(world, name).behaviour = 'the program';
});

Given('the {word} client port answers as some other program', (world: EndpointWorld, name: string) => {
  named(world, name).behaviour = 'some other program';
});

Given('the {word} client port refuses the key', (world: EndpointWorld, name: string) => {
  named(world, name).behaviour = 'refusing';
});

Given('the {word} client port is switched off', async (world: EndpointWorld, name: string) => {
  await close(named(world, name));
});

When('the client address {string} is detected from a page loaded over {word}', async (world: EndpointWorld, typed: string, page: string) => {
  try {
    world.endpointDetected = await detectClientEndpoint(typed, page as PageScheme, probeFor(world));
  } catch (error) {
    world.endpointError = error;
  }
});

Then('the detected client address is {string} with notes {string}', (world: EndpointWorld, url: string, notes: string) => {
  expect(world.endpointError).toBeUndefined();
  expect(world.endpointDetected?.endpoint).toMatchObject({ ok: true, url, notes: splitList(notes) });
});

Then('the detection result came from the {word} client port', (world: EndpointWorld, name: string) => {
  expect(world.endpointDetected?.result).toBe(name);
});

Then('the client address detection asked {string}', (world: EndpointWorld, expected: string) => {
  expect(world.endpointAsked).toEqual(splitList(expected));
});

Then('the client address detection fails with {string}', (world: EndpointWorld, reason: string) => {
  expect(world.endpointDetected).toBeUndefined();
  expectReason(world.endpointError, reason);
});
