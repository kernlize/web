import { expect, vi } from 'vitest';
import { After } from 'quickpickle';
import type { NappletMessage } from '@napplet/core';
import type { ServiceHandler, ServiceRuntimeContext } from '@kehto/runtime';
import { createDownloadClients, createKernlDownloads, createStorageSecrets, type DownloadClients, type DownloadDomain, type DownloadQuestion, type DownloadService, type KernlDownloads, type SecretsProvider } from '@kernlize/core';
import { MemoryStorage, scratch, type CoreWorld } from './world.js';

export type Wire = Record<string, unknown>;

/** One program on loopback the scenario set up as a connection. */
export interface RoutedServer {
  readonly url: string;
  readonly signIn: { readonly username?: string; readonly password?: string; readonly apiKey?: string };
  close(): Promise<void>;
}

/** Everything a routing scenario holds: the real store, the services over it, and the programs behind it. */
export interface RoutingState {
  readonly storage: MemoryStorage;
  /** Connection ids whose kept secrets the provider will not hand over. */
  readonly withheld: Set<string>;
  readonly servers: Map<string, RoutedServer>;
  /** Connection ids by label. */
  readonly ids: Map<string, string>;
  /** Window id to the applet it runs. */
  readonly windows: Map<string, string>;
  readonly replies: Wire[];
  readonly questions: DownloadQuestion[];
  /** Handles the services issued, by `<window>/<name>`. */
  readonly handles: Map<string, string>;
  /** How many requests each server had had when its connection was removed, by label. */
  readonly removedAt: Map<string, number>;
  programs?: DownloadClients;
  downloads?: KernlDownloads;
  torrent?: DownloadService;
  clock: number;
  serial: number;
  last?: Wire;
}

export function routing(world: CoreWorld): RoutingState {
  const bag = scratch(world) as { routing?: RoutingState };
  bag.routing ??= {
    storage: new MemoryStorage(), withheld: new Set(), servers: new Map(), ids: new Map(), windows: new Map(), replies: [], questions: [], handles: new Map(), removedAt: new Map(), clock: 1_793_361_600_000, serial: 0,
  };
  return bag.routing;
}

export function programs(state: RoutingState): DownloadClients {
  const value = state.programs ?? state.downloads?.programs;
  if (!value) throw new Error('set the programs up first');
  return value;
}

export function idOf(state: RoutingState, label: string): string {
  const id = state.ids.get(label);
  if (!id) throw new Error(`no connection called ${label}`);
  return id;
}

export function serverOf<T extends RoutedServer>(state: RoutingState, label: string): T {
  const server = state.servers.get(label);
  if (!server) throw new Error(`no program called ${label}`);
  return server as T;
}

/** The default provider over the scenario's storage, withholding the secrets of the connections named. */
export function withholdingSecrets(state: RoutingState): SecretsProvider {
  const real = createStorageSecrets(state.storage);
  return {
    description: real.description,
    get: (name) => ([...state.withheld].some((id) => name.includes(id)) ? Promise.reject(new Error('unavailable:secrets')) : real.get(name)),
    set: (name, value) => real.set(name, value),
    delete: (name) => real.delete(name),
  };
}

/** The settings store alone over the scenario's storage, as a shell opens it. */
export async function openStore(state: RoutingState): Promise<DownloadClients> {
  state.programs = createDownloadClients({ storage: state.storage, secrets: withholdingSecrets(state), pageScheme: () => 'http' });
  await state.programs.ready;
  return state.programs;
}

/** The composed download services, wired as `createKernlDownloads` wires them, answering every question yes. */
export function openShell(state: RoutingState): KernlDownloads {
  state.downloads = createKernlDownloads({
    host: {
      storage: state.storage,
      presentConsent: (prompt) => {
        state.questions.push({ kind: 'add', title: prompt.summary.title, lines: prompt.summary.lines.map((line) => ({ label: line.label, value: String(line.after) })) });
        prompt.resolve(true);
      },
      now: () => state.clock,
    },
    options: { offer: true, pageScheme: () => 'http' },
    secrets: withholdingSecrets(state),
    identityOf: (windowId) => (state.windows.has(windowId) ? { dTag: state.windows.get(windowId) as string, hash: 'cd'.repeat(32) } : undefined),
    ownerOf: (windowId) => state.windows.get(windowId),
    fetchDocument: () => Promise.reject(new Error('unavailable:not-used')),
  });
  return state.downloads;
}

/** A handler's pushes go nowhere a scenario reads; routing scenarios read answers. */
export function register(handler: ServiceHandler): void {
  const runtime: Pick<ServiceRuntimeContext, 'sendToEligibleNapplet'> = { sendToEligibleNapplet: () => true };
  handler.onRegistered?.(runtime as ServiceRuntimeContext);
}

export function handlerFor(state: RoutingState, domain: DownloadDomain): ServiceHandler {
  const handler = domain === 'torrent' ? state.torrent?.handler : state.downloads?.services[domain];
  if (!handler) throw new Error(`no ${domain} service`);
  return handler;
}

/** Sends one request from a window and resolves its one answer. */
export async function request(state: RoutingState, domain: DownloadDomain, windowId: string, message: Wire): Promise<Wire> {
  state.serial += 1;
  const id = `r-${state.serial}`;
  const envelope: NappletMessage & Wire = { ...message, type: String(message.type), id };
  handlerFor(state, domain).handleMessage(windowId, envelope, (reply) => void state.replies.push({ ...reply }));
  await vi.waitFor(() => expect(state.replies.some((reply) => reply.id === id)).toBe(true), { timeout: 3000, interval: 5 });
  state.last = state.replies.find((reply) => reply.id === id) as Wire;
  return state.last;
}

export function lastAnswer(state: RoutingState): Wire {
  if (!state.last) throw new Error('no request was answered yet');
  return state.last;
}

After(async (world: CoreWorld) => {
  const state = (scratch(world) as { routing?: RoutingState }).routing;
  if (!state) return;
  state.torrent?.dispose();
  state.downloads?.dispose();
  await Promise.all([...state.servers.values()].map((server) => server.close()));
});
