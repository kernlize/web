/**
 * `@kernlize/modules/downloads`: the downloads module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export { downloadsModule } from '../modules/downloads.js';
export type { DownloadQuestion, DownloadQuestionLine, DownloadService, DownloadServiceDeps } from '../downloads/types.js';
export { createDownloadClients, currentPageScheme, DOWNLOAD_PROGRAMS, type CheckedConnection, type ClientFor, type ConnectionChange, type ConnectionRouting, type DownloadClients, type DownloadClientsOptions, type DownloadClientsState, type DownloadConnection, type DownloadDomain, type DownloadProgram, type DownloadProgramInfo, type DownloadSignIn, type RoutedClient, type RoutedDomain } from '../downloads/download-clients.js';
export { DOWNLOAD_BINDINGS, supportsDomainBindings, type BoundPreludeOptions, type DomainBinding, type DomainBindingMethod } from '../downloads/bindings.js';
export { createTorrentService, type TorrentServiceOptions } from '../downloads/torrent-service.js';
export { createNzbService, readNzbDocument, type NzbDocument, type NzbDownloader, type NzbServiceOptions } from '../downloads/nzb-service.js';
export { createSoulseekService, DEFAULT_SOULSEEK_LIMITS, SOULSEEK_SESSION_QUESTION, type SoulseekLimits, type SoulseekServiceOptions } from '../downloads/soulseek-service.js';
export { createKernlDownloads, describeDownloadQuestion, DOWNLOAD_DOMAINS, type KernlDownloads, type KernlDownloadsDeps } from '../kernl-downloads.js';
