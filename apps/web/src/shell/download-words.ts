import type { DownloadJob, DownloadState } from '@kernl/bridges';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** `1.5 MB` style sizes, in powers of 1024. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${UNITS[unit]}`;
}

const STATES: Readonly<Record<DownloadState, string>> = {
  connecting: 'Looking for peers',
  downloading: 'Downloading',
  paused: 'Paused',
  done: 'Finished',
  failed: 'Could not finish',
};

const peers = (count: number): string => `${count} ${count === 1 ? 'peer' : 'peers'}`;

/** One line under a download's name: where it stands, how far, and from how many peers. */
export function describeDownload(job: DownloadJob): string {
  const parts = [STATES[job.state]];
  if (job.state === 'failed') return job.error === undefined ? parts[0] : `${parts[0]}: ${job.error}`;
  if (job.size !== undefined) parts.push(`${formatBytes(job.received)} of ${formatBytes(job.size)}`);
  if (job.state === 'downloading') parts.push(peers(job.peers), `${formatBytes(job.speed)}/s`);
  return parts.join(' · ');
}
