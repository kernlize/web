import { readNzbFiles, readNzbJobs } from './nzb-requests.js';
import { describeNzbJob, nzbDownloaderOf, nzbDownloaders, nzbJobOf, observeNzbJob, type NzbCall, type NzbDownloader, type NzbSession } from './nzb-session.js';
import { need, NZB_LIMITS, NzbFault, type NzbDownloaderInfo, type NzbDownloadersResult, type NzbJob, type NzbJobsResult } from './nzb-wire.js';

const encoder = new TextEncoder();
/** A string whose code units are the text's UTF-8 bytes, so plain comparison is byte order (NAP-NZB, Jobs and state). */
const byteOrder = (text: string): string => String.fromCharCode(...encoder.encode(text));

/**
 * `nzb.downloaders`: what each downloader the person set up can do, under a handle
 * that is this applet's alone. A downloader that does not answer is still listed, with
 * no categories; its trouble is reported when something is asked of it.
 *
 * @param session - The service's session.
 * @param call - Whose request this is.
 * @returns The `DownloadersResult`.
 * @example
 * ```ts
 * (await describeNzbDownloaders(session, call)).downloaders[0]?.canReadFiles; // false
 * ```
 */
export async function describeNzbDownloaders(session: NzbSession, call: NzbCall): Promise<NzbDownloadersResult> {
  const { handles, options } = session;
  const describe = async ({ client, key, label }: NzbDownloader): Promise<NzbDownloaderInfo> => {
    const offered = client.addOptions.includes('categoryId') ? await client.categories().catch(() => []) : [];
    return {
      downloaderId: handles.downloaderId(call.applet, key),
      label,
      canAdd: true,
      sourceKinds: options.fetchDocument ? ['bytes', 'url'] : ['bytes'],
      addOptions: [...new Set(client.addOptions)],
      categories: offered.map(({ name }) => ({
        categoryId: handles.categoryId(call.applet, key, name, true) as string,
        label: name,
        description: `The settings ${label} keeps for this category decide where files go and what is done with them afterwards`,
      })),
      actions: [...new Set(client.actions)],
      canReadFiles: false,
      ...NZB_LIMITS,
    };
  };
  return { downloaders: await Promise.all(nzbDownloaders(session).map(describe)) };
}

/**
 * `nzb.jobs`: one page of the jobs this applet submitted to one downloader, in
 * ascending byte order of their handles. Jobs the person or another applet added are
 * not listed; a downloader that cannot be asked is an error, not an empty page.
 *
 * @param session - The service's session.
 * @param call - Whose request this is.
 * @param raw - The `JobsRequest` as received.
 * @returns The `JobsResult`.
 * @example
 * ```ts
 * const { jobs, next } = await listNzbJobs(session, call, { downloaderId, limit: 10 });
 * ```
 */
export async function listNzbJobs(session: NzbSession, call: NzbCall, raw: unknown): Promise<NzbJobsResult> {
  const { downloaderId, after, limit } = readNzbJobs(raw);
  const downloader = nzbDownloaderOf(session, call.applet, downloaderId);
  const reported = new Map((await downloader.client.list()).map((job) => [job.id, job]));
  const jobs: NzbJob[] = [];
  for (const handle of session.handles.jobs(call.applet, downloader.key)) {
    const job = reported.get(handle.backend);
    if (job) jobs.push(describeNzbJob(session, { handle, downloader }, job));
    else session.handles.retire(call.applet, handle.id);
  }
  const visible = jobs.filter((job) => after === undefined || byteOrder(job.jobId) > byteOrder(after)).sort((left, right) => (byteOrder(left.jobId) < byteOrder(right.jobId) ? -1 : 1));
  const page = visible.slice(0, limit);
  return { jobs: page, next: visible.length > page.length ? (page.at(-1) as NzbJob).jobId : null };
}

/**
 * `nzb.status`: a fresh observation of one job the applet submitted.
 *
 * @param session - The service's session.
 * @param call - Whose request this is.
 * @param jobId - The job handle from the message.
 * @returns The `Job`.
 * @example
 * ```ts
 * (await nzbStatus(session, call, jobId)).state; // 'downloading'
 * ```
 */
export async function nzbStatus(session: NzbSession, call: NzbCall, jobId: unknown): Promise<NzbJob> {
  const owned = nzbJobOf(session, call.applet, jobId as string);
  return describeNzbJob(session, owned, await observeNzbJob(session, owned));
}

/**
 * `nzb.files` and `nzb.read`: always `unsupported`. kernl drives a downloader through
 * its own API and has no authorised mapping to what it saved; a path the downloader
 * reports is not one (NAP-NZB, Optional completed-file access).
 *
 * @param session - The service's session.
 * @param call - Whose request this is.
 * @param raw - The `FilesRequest` or `ReadRequest` as received.
 * @param reading - Whether this is `nzb.read`.
 * @returns Never; a job that is not the applet's is `not_found` first.
 * @example
 * ```ts
 * await nzbFiles(session, call, { jobId }, false); // rejects: unsupported
 * ```
 */
export async function nzbFiles(session: NzbSession, call: NzbCall, raw: unknown, reading: boolean): Promise<never> {
  need(!nzbJobOf(session, call.applet, readNzbFiles(raw, reading)).handle.gone, 'not_found', 'No such download');
  throw new NzbFault('unsupported', 'The shell cannot read what this downloader saved');
}
