import type { NappletMessage } from '@napplet/core';
import { createNzbService } from '../../src/downloads/nzb-service.js';
import type { DownloadQuestion, DownloadService } from '../../src/downloads/types.js';
import { MemoryNzbClient } from './memory-nzb-client.js';
import { nzbDocument } from './nzb-documents.js';
import { MemoryStorage, scratch, type CoreWorld } from './world.js';

export type Wire = NappletMessage & { id?: string; result?: Record<string, unknown>; error?: { code: string; message: string; replayUntil?: number } };

export interface NzbSetup {
  readonly key: string;
  readonly label: string;
  readonly client: MemoryNzbClient;
}

export interface NzbState {
  storage: MemoryStorage;
  /** Milliseconds; undefined leaves the service on the real clock. */
  clock: number | undefined;
  downloaders: NzbSetup[];
  /** Window id to the applet it runs; a window absent here is not a live applet. */
  applets: Map<string, string>;
  service: DownloadService | undefined;
  /** Every message a window was sent, and those a scenario counts (discovery done on a step's behalf is not counted). */
  sent: Map<string, Wire[]>;
  counted: Map<string, Wire[]>;
  /** The id of the request each window last made. */
  awaiting: Map<string, string>;
  questions: Array<{ windowId: string; question: DownloadQuestion }>;
  answer: boolean | 'never' | 'broken';
  whileAsked: Array<() => void>;
  fetcher: boolean;
  pages: Map<string, string>;
  fetches: number;
  fetchStopped: boolean;
  /** Handles by what scenarios call them: `<window>/downloader/<label>`, `<window>/category/<name>`, `<window>/job/<key>`. */
  names: Map<string, string>;
  before: Map<string, string>;
  seen: string[];
  nextId: number;
}

export function nzb(world: CoreWorld): NzbState {
  const core = scratch(world);
  core.nzb ??= {
    storage: new MemoryStorage(), clock: 0, downloaders: [], applets: new Map(), service: undefined, sent: new Map(), counted: new Map(), awaiting: new Map(), questions: [],
    answer: true, whileAsked: [], fetcher: false, pages: new Map(), fetches: 0, fetchStopped: false, names: new Map(), before: new Map(), seen: [], nextId: 1,
  } satisfies NzbState;
  return core.nzb as NzbState;
}

export const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await pause(2);
  }
}

export function setup(state: NzbState, label: string): NzbSetup {
  const found = state.downloaders.find((downloader) => downloader.label === label);
  if (!found) throw new Error(`no NZB downloader called ${label}`);
  return found;
}

/** The service, made on first use so a scenario can arrange the shell first; a reload drops it and the next use makes another. */
export function service(state: NzbState): DownloadService {
  state.service ??= createNzbService({
    downloaders: () => state.downloaders,
    ownerOf: (windowId) => state.applets.get(windowId),
    appletOf: (windowId) => (state.applets.has(windowId) ? { dTag: (state.applets.get(windowId) as string).split(':').at(-1) as string, hash: 'cd'.repeat(32) } : undefined),
    async ask(windowId, question) {
      state.questions.push({ windowId, question });
      state.whileAsked.shift()?.();
      // A host whose prompt fails need not reject with an Error.
      if (state.answer === 'broken') throw 'the prompt could not be shown';
      return state.answer === 'never' ? new Promise<boolean>(() => undefined) : state.answer;
    },
    storage: state.storage,
    ...(state.clock === undefined ? {} : { now: () => state.clock as number }),
    ...(state.fetcher
      ? {
          async fetchDocument(url: string, signal: AbortSignal) {
            state.fetches += 1;
            const page = state.pages.get(url);
            if (page === undefined) throw new Error(`GET ${url} answered 404`);
            if (page !== 'never') return nzbDocument(page);
            return new Promise<Uint8Array>((_resolve, reject) => {
              signal.addEventListener('abort', () => {
                state.fetchStopped = true;
                reject(new Error('aborted'));
              });
            });
          },
        }
      : {}),
  });
  return state.service;
}

const listOf = (map: Map<string, Wire[]>, windowId: string): Wire[] => map.get(windowId) ?? (map.set(windowId, []).get(windowId) as Wire[]);

/** Sends one message from a window without waiting for its answer; resolves with the id it carried. */
export function post(state: NzbState, windowId: string, body: Record<string, unknown>, quiet = false): string {
  const id = typeof body.id === 'string' ? body.id : `r${state.nextId++}`;
  state.awaiting.set(windowId, id);
  const message: NappletMessage & Record<string, unknown> = { type: String(body.type), ...('id' in body ? body : { ...body, id }) };
  service(state).handler.handleMessage(windowId, message, (sent) => {
    listOf(state.sent, windowId).push(sent as Wire);
    if (!quiet) listOf(state.counted, windowId).push(sent as Wire);
  });
  return id;
}

export const answerTo = (state: NzbState, windowId: string, id: string): Wire | undefined => listOf(state.sent, windowId).find((message) => message.id === id);

function remember(state: NzbState, windowId: string, answer: Wire, key?: string): void {
  for (const downloader of (answer.result?.downloaders ?? []) as Array<{ downloaderId: string; label: string; categories: Array<{ categoryId: string; label: string }> }>) {
    state.names.set(`${windowId}/downloader/${downloader.label}`, downloader.downloaderId);
    for (const category of downloader.categories) state.names.set(`${windowId}/category/${category.label}`, category.categoryId);
  }
  const job = answer.result?.job as { jobId: string } | undefined;
  if (key !== undefined && job && !state.names.has(`${windowId}/job/${key}`)) state.names.set(`${windowId}/job/${key}`, job.jobId);
}

/** The answer to the request a window last made, waited for. */
export async function answered(state: NzbState, windowId: string): Promise<Wire> {
  const id = state.awaiting.get(windowId) as string;
  await until(() => answerTo(state, windowId, id) !== undefined, `the answer to ${id}`);
  return answerTo(state, windowId, id) as Wire;
}

/** Sends one message and waits for its answer; `key` names the job the answer may carry. */
export async function request(state: NzbState, windowId: string, body: Record<string, unknown>, options: { key?: string; quiet?: boolean } = {}): Promise<Wire> {
  post(state, windowId, body, options.quiet);
  const answer = await answered(state, windowId);
  remember(state, windowId, answer, options.key);
  return answer;
}

/** A window's handle for a downloader, discovering it on the scenario's behalf when it has not asked yet. */
export async function downloaderId(state: NzbState, windowId: string, label: string): Promise<string> {
  if (!state.names.has(`${windowId}/downloader/${label}`)) await request(state, windowId, { type: 'nzb.downloaders' }, { quiet: true });
  return state.names.get(`${windowId}/downloader/${label}`) ?? 'unknown-downloader';
}

/** The handle of the job added under a key: the window's own, or whichever window has one, to try someone else's. */
export function jobId(state: NzbState, windowId: string, key: string): string {
  const own = state.names.get(`${windowId}/job/${key}`);
  const other = [...state.names].find(([name]) => name.endsWith(`/job/${key}`))?.[1];
  const found = own ?? other;
  if (found === undefined) throw new Error(`no NZB job was added under ${key}`);
  return found;
}

/** The downloader's own number for the job a window added under a key. */
export function backendId(state: NzbState, key: string): string {
  const handle = [...state.names].find(([name]) => name.endsWith(`/job/${key}`))?.[1];
  const stored = JSON.parse(state.storage.getItem('kernl:nzb-handles:v1') as string) as { jobs: Array<{ id: string; backend: string }> };
  return (stored.jobs.find((row) => row.id === handle) as { backend: string }).backend;
}

export type Job = Record<string, unknown> & { jobId: string; state: string };

export const everythingSent = (state: NzbState, windowId: string): string => JSON.stringify(state.sent.get(windowId) ?? []);
export const jobOf = (answer: Wire): Job => (answer.result?.job ?? answer.result) as Job;
export const lastJobs = (answer: Wire): Job[] => answer.result?.jobs as Job[];

export const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** An `nzb.add` for a named document, with the options a scenario's table gives. */
export async function addRequest(state: NzbState, windowId: string, target: { document: string; label: string; key: string }, table: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const { name, category, priority, startPaused, password } = table;
  return {
    type: 'nzb.add',
    request: {
      downloaderId: await downloaderId(state, windowId, target.label),
      operationKey: target.key,
      source: { kind: 'bytes', dataBase64: base64(nzbDocument(target.document)) },
      ...(name === undefined ? {} : { name }),
      ...(category === undefined ? {} : { categoryId: state.names.get(`${windowId}/category/${category}`) ?? 'unknown-category' }),
      ...(priority === undefined ? {} : { priority }),
      ...(startPaused === undefined ? {} : { startPaused: startPaused === 'true' }),
      ...(password === undefined ? {} : { password }),
    },
  };
}
