import { expect } from 'vitest';
import type { Bridge, BridgeContext, BridgeResult, Locator } from '@kernl/bridges';

export const VALID_MAGNET = 'magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01';

export interface FakeBridge extends Bridge {
  unavailable?: string;
  failure?: unknown;
  result: BridgeResult;
}

export interface RecordedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

export interface FakeServer {
  /** Redirect answers keyed by URL; anything else gets `answer`. */
  readonly redirects: Map<string, string>;
  readonly requests: RecordedRequest[];
  answer: () => Response;
  mode: 'answer' | 'hang' | 'fail';
  failure: unknown;
}

export interface BridgeWorld {
  locator?: Locator;
  error?: unknown;
  registry?: import('@kernl/bridges').BridgeRegistry;
  fakes?: Map<string, FakeBridge>;
  events?: import('@kernl/bridges').BridgeResolveEvent[];
  consentSeen?: { bridge: string; scheme: string };
  result?: BridgeResult;
  seenContext?: BridgeContext;
  server?: FakeServer;
  webBridge?: Bridge;
  bridge?: Bridge;
  backendCalls?: unknown[][];
  resolver?: import('@kernl/bridges').BridgeResourceResolver;
  response?: Response;
}

export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function expectReason(error: unknown, expected: string): void {
  expect(error).toBeDefined();
  expect(reasonOf(error).slice(0, expected.length)).toBe(expected);
}

export async function capture<T>(world: BridgeWorld, run: () => Promise<T>): Promise<void> {
  world.error = undefined;
  try {
    const value = await run();
    if (value instanceof Response) world.response = value;
    else world.result = value as BridgeResult;
  } catch (error) {
    world.error = error;
  }
}

export function splitList(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
