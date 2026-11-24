import type { Ask } from './asks/kinds.js';
import type { ServiceRegistry } from '@kehto/runtime';
import type { PlannedExtensions } from './applets/plan.js';
import { DOWNLOAD_BINDINGS, supportsDomainBindings } from './downloads/bindings.js';
import { createDownloadClients, type DownloadClients } from './downloads/download-clients.js';
import { createNzbService } from './downloads/nzb-service.js';
import { createSoulseekService } from './downloads/soulseek-service.js';
import { createTorrentService } from './downloads/torrent-service.js';
import type { DownloadQuestion, DownloadService, DownloadServiceDeps } from './downloads/types.js';
import type { SecretsProvider } from './secrets/secrets.js';
import type { AppletIdentity, ConsentSummary, DownloadsOptions, KernlHost } from './types.js';

/**
 * The domains kernl serves by driving the person's own download programs, in the order they are offered.
 *
 * @example
 * ```ts
 * DOWNLOAD_DOMAINS.includes('nzb'); // true
 * ```
 */
export const DOWNLOAD_DOMAINS: readonly string[] = Object.freeze(['torrent', 'nzb', 'soulseek']);

/** What the download services need from the composed shell. */
export interface KernlDownloadsDeps {
  readonly host: Pick<KernlHost, 'storage' | 'now'>;
  /** Put a download program's question to the person as a `download.add` ask; resolve true only on yes. */
  readonly ask: (ask: Ask<'download.add'>) => Promise<boolean>;
  readonly options: DownloadsOptions | undefined;
  /** Where the programs' passwords and keys are kept. */
  readonly secrets: SecretsProvider;
  /** The verified applet a window runs, or undefined. */
  readonly identityOf: (windowId: string) => AppletIdentity | undefined;
  /** The catalogue id of the applet a window runs, which what it starts is kept under. */
  readonly ownerOf: (windowId: string) => string | undefined;
  /** Fetches an NZB an applet named by address, under the shell's own fetch policy. */
  readonly fetchDocument: (url: string, signal: AbortSignal) => Promise<Uint8Array>;
}

/** The download programs' settings, the services over them when they can be offered, and their teardown. */
export interface KernlDownloads {
  readonly programs: DownloadClients;
  /** The handlers to register, keyed by domain; empty when the domains cannot be offered. */
  readonly services: ServiceRegistry;
  /** What planning adds to an applet's environment; undefined when the domains cannot be offered. */
  readonly extensions: PlannedExtensions | undefined;
  dispose(): void;
}

/**
 * A download service's question as the host's consent prompt takes it. Starting something
 * that shows peers the address of the machine doing the transfer is `direct`; erasing files
 * is `destructive`; an archive download, which only the person's own servers see, is `routine`.
 *
 * @param question - What the service asks.
 * @param applet - The applet it asks for.
 * @param exposesAddress - Whether peers learn a network address from what is being started.
 * @returns The summary the host renders.
 * @example
 * ```ts
 * describeDownloadQuestion({ kind: 'delete', title: 'Delete the files', lines: [] }, identity, true).severity; // 'destructive'
 * ```
 */
export function describeDownloadQuestion(question: DownloadQuestion, applet: AppletIdentity, exposesAddress: boolean): ConsentSummary {
  const started = exposesAddress ? 'direct' : 'routine';
  return {
    title: question.title,
    severity: question.kind === 'delete' ? 'destructive' : started,
    lines: question.lines.map((line) => ({ label: line.label, after: line.value })),
    applet,
  };
}

/**
 * The three download domains over the programs the person set up (D-050).
 *
 * The settings are always there, so the person can set a program up before any applet asks
 * for it. The services are created, and the domains offered, only when kehto's prelude can
 * bind a domain it does not build in (`supportsDomainBindings`), or the host says its own
 * does (`downloads.offer`). Every question a service has goes to the person through the
 * host's consent prompt, in the name of the applet that caused it; a window that is no
 * longer a live applet is answered no without asking.
 *
 * @param deps - Host, options, the secrets provider, the window-to-applet lookup and the NZB fetcher.
 * @returns Settings, handlers, the planning extension and teardown.
 * @example
 * ```ts
 * const downloads = createKernlDownloads({ host, options: undefined, secrets: createStorageSecrets(host.storage), identityOf, ownerOf, fetchDocument });
 * Object.assign(services.registry, downloads.services);
 * ```
 */
export function createKernlDownloads(deps: KernlDownloadsDeps): KernlDownloads {
  const { host, options } = deps;
  const programs = createDownloadClients({
    storage: host.storage,
    secrets: deps.secrets,
    ...(options?.pageScheme ? { pageScheme: options.pageScheme } : {}),
    ...(options?.fetch ? { fetch: options.fetch } : {}),
  });
  if (!(options?.offer ?? supportsDomainBindings())) return { programs, services: {}, extensions: undefined, dispose: () => undefined };

  const base = (exposesAddress: boolean): DownloadServiceDeps => ({
    appletOf: deps.identityOf,
    ownerOf: deps.ownerOf,
    storage: host.storage,
    ...(host.now ? { now: host.now.bind(host) } : {}),
    ask(windowId, question) {
      const applet = deps.identityOf(windowId);
      if (!applet) return Promise.resolve(false);
      return deps.ask({ kind: 'download.add', windowId, applet, facts: { question, exposesAddress }, defaultText: describeDownloadQuestion(question, applet, exposesAddress) });
    },
  });
  // An NZB downloader is keyed by its connection's routing key, so a handle issued for jobs at an old address never reaches the new one's.
  const nzb = programs.routing('nzb');
  const created: Readonly<Record<string, DownloadService>> = {
    torrent: createTorrentService({ ...base(true), connections: programs.routing('torrent') }),
    nzb: createNzbService({ ...base(false), downloaders: () => nzb.all().map(({ connection, client }) => ({ key: connection.routingKey, label: connection.label, client })), fetchDocument: deps.fetchDocument }),
    soulseek: createSoulseekService({ ...base(true), connections: programs.routing('soulseek') }),
  };
  return {
    programs,
    services: Object.fromEntries(Object.entries(created).map(([domain, service]) => [domain, service.handler])),
    extensions: { domains: DOWNLOAD_DOMAINS, bindings: DOWNLOAD_BINDINGS },
    dispose: () => Object.values(created).forEach((service) => service.dispose()),
  };
}
