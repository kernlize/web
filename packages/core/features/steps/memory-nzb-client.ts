import type { ClientProbe, NzbClient, NzbClientAction, NzbClientAdd, NzbClientAddOption, NzbClientCategory, NzbClientJob, NzbClientState } from '../../../bridges/src/clients/types.js';

type Method = 'categories' | 'add' | 'list' | 'get' | 'control';

interface Held {
  id: string;
  name: string;
  state: NzbClientState;
  paused: boolean;
  category?: string;
  extra: Partial<NzbClientJob>;
}

const TERMINAL: readonly NzbClientState[] = ['completed', 'failed', 'cancelled', 'skipped'];

/**
 * An NZB downloader that lives in memory and keeps the `NzbClient` contract: a queue
 * and a history merged into one list, per-job holds, numbered jobs, categories, and
 * the contract's own rejections. Scenarios advance jobs, make the next call fail, hold
 * a call open, or run something the moment a call arrives.
 */
export class MemoryNzbClient implements NzbClient {
  actions: NzbClientAction[] = ['pause', 'resume', 'cancel', 'retry', 'forget', 'delete'];
  addOptions: NzbClientAddOption[] = ['categoryId', 'priority', 'startPaused', 'password'];
  categoryNames: string[] = [];
  /** Whether a retry restarts the same job or makes a successor with a number of its own. */
  retryInPlace = false;
  /** Whether a document already queued under the same name is answered with the job it already has. */
  joinDuplicates = false;
  /** Every call made, by method. */
  readonly calls: Method[] = [];
  /** Every submission that reached the downloader. */
  readonly added: NzbClientAdd[] = [];
  /** Jobs whose files were erased. */
  readonly erased: string[] = [];
  readonly jobs = new Map<string, Held>();
  private nextId = 1;
  private readonly failures = new Map<Method, string[]>();
  private readonly watchers = new Map<Method, Array<() => void>>();
  private gate: { method: Method; open: Promise<void> } | undefined;
  private releaseHeld: () => void = () => undefined;
  /** When set, every call after the named one rejects as unreachable. */
  silentAfter: Method | undefined;
  silent = false;
  /** When set, the next add is taken but its acknowledgement is lost. */
  loseNextAdd = false;

  /** Makes the next call of a method reject with a reason. */
  failNext(method: Method, reason: string): void {
    this.failures.set(method, [...(this.failures.get(method) ?? []), reason]);
  }

  /** Runs something once, the moment the next call of a method arrives. */
  onNext(method: Method, run: () => void): void {
    this.watchers.set(method, [...(this.watchers.get(method) ?? []), run]);
  }

  /** Keeps the next call of a method waiting until {@link release}. */
  hold(method: Method): void {
    const open = new Promise<void>((resolve) => {
      this.releaseHeld = resolve;
    });
    this.gate = { method, open };
  }

  release(): void {
    this.releaseHeld();
  }

  count(method: Method): number {
    return this.calls.filter((call) => call === method).length;
  }

  /** A job the person added themselves, outside any applet. */
  addOwn(name: string): string {
    return this.insert(name, 'queued', false);
  }

  private insert(name: string, state: NzbClientState, paused: boolean, category?: string): string {
    const id = String(this.nextId++);
    this.jobs.set(id, { id, name, state, paused, extra: {}, ...(category === undefined ? {} : { category }) });
    return id;
  }

  private async enter(method: Method): Promise<void> {
    this.calls.push(method);
    this.watchers.get(method)?.shift()?.();
    if (this.gate?.method === method) {
      const { open } = this.gate;
      this.gate = undefined;
      await open;
    }
    if (this.silent) throw new Error('unavailable:unreachable connection refused at 10.0.0.9:6789');
    const reason = this.failures.get(method)?.shift();
    if (reason !== undefined) throw new Error(`${reason} (http://10.0.0.9:6789/jsonrpc, key hunter2)`);
    if (this.silentAfter === method) this.silent = true;
  }

  private describe(job: Held): NzbClientJob {
    const possible: NzbClientAction[] = TERMINAL.includes(job.state)
      ? ['forget', 'delete', ...(job.state === 'failed' || job.state === 'cancelled' ? (['retry'] as const) : [])]
      : job.state === 'processing'
        ? ['cancel']
        : [job.paused ? 'resume' : 'pause', 'cancel'];
    return {
      id: job.id,
      name: job.name,
      state: job.state,
      paused: job.paused,
      ...(job.category === undefined ? {} : { category: job.category }),
      ...job.extra,
      actions: possible.filter((action) => this.actions.includes(action)),
    };
  }

  async probe(): Promise<ClientProbe> {
    return { version: 'memory-1' };
  }

  async categories(): Promise<readonly NzbClientCategory[]> {
    await this.enter('categories');
    return this.categoryNames.map((name) => ({ name }));
  }

  async add(request: NzbClientAdd): Promise<{ readonly id: string }> {
    await this.enter('add');
    this.added.push(request);
    const twin = this.joinDuplicates ? [...this.jobs.values()].find((job) => job.name === request.name) : undefined;
    if (twin) return { id: twin.id };
    const paused = request.paused === true;
    const id = this.insert(request.name, paused ? 'paused' : 'queued', paused, request.category);
    if (this.loseNextAdd) {
      this.loseNextAdd = false;
      throw new Error('unavailable:outcome-unknown the connection dropped after the request was sent');
    }
    return { id };
  }

  async list(): Promise<readonly NzbClientJob[]> {
    await this.enter('list');
    return [...this.jobs.values()].map((job) => this.describe(job));
  }

  async get(id: string): Promise<NzbClientJob | undefined> {
    await this.enter('get');
    const job = this.jobs.get(id);
    return job && this.describe(job);
  }

  async control(id: string, action: NzbClientAction): Promise<{ readonly id: string }> {
    await this.enter('control');
    const job = this.jobs.get(id);
    if (!job) throw new Error('unavailable:not-found');
    if (!this.describe(job).actions.includes(action)) throw new Error('unavailable:rejected');
    if (action === 'pause' || action === 'resume') {
      job.paused = action === 'pause';
      job.state = job.paused ? 'paused' : 'queued';
    } else if (action === 'cancel') {
      job.state = 'cancelled';
    } else if (action === 'retry' && this.retryInPlace) {
      job.state = 'queued';
    } else {
      this.jobs.delete(id);
      if (action === 'delete') this.erased.push(id);
      if (action === 'retry') return { id: this.insert(job.name, 'queued', false, job.category) };
    }
    return { id };
  }
}
