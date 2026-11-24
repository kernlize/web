import { bindingMethod as call, type DomainBinding, type DomainBindingMethod } from '../applets/domain-bindings.js';

const torrent = (action: string, result: string, ...params: string[]): DomainBindingMethod => call(`torrent.${action}`, result, ...params);
const nzb = (action: string, ...params: string[]): DomainBindingMethod => call(`nzb.${action}`, 'result', ...params);
const soulseek = (action: string, ...params: string[]): DomainBindingMethod => call(`soulseek.${action}`, 'value', ...params);

export { type BoundPreludeOptions, type DomainBinding, type DomainBindingMethod, supportsDomainBindings } from '../applets/domain-bindings.js';

/**
 * The applet-side bindings for the three download domains, one row per operation of
 * NAP-TORRENT, NAP-NZB and NAP-SOULSEEK's wire tables. The shell hands them to kehto's
 * namespace prelude, which turns each row into a method over the applet's private port.
 *
 * @example
 * ```ts
 * DOWNLOAD_BINDINGS.torrent?.methods.add; // { type: 'torrent.add', params: ['request'], reply: true, result: 'ack' }
 * Object.keys(DOWNLOAD_BINDINGS); // ['torrent', 'nzb', 'soulseek']
 * ```
 */
export const DOWNLOAD_BINDINGS: Readonly<Record<string, DomainBinding>> = Object.freeze({
  torrent: {
    methods: {
      capabilities: torrent('capabilities', 'capabilities'),
      pickFiles: torrent('pickFiles', 'result', 'options'),
      add: torrent('add', 'ack', 'request'),
      status: torrent('status', 'status', 'jobId'),
      jobs: torrent('jobs', 'jobs', 'filter'),
      files: torrent('files', 'files', 'jobId'),
      selectFiles: torrent('selectFiles', 'status', 'jobId', 'selection'),
      pause: torrent('pause', 'status', 'jobId'),
      resume: torrent('resume', 'status', 'jobId'),
      remove: torrent('remove', 'result', 'jobId', 'options'),
      metadata: torrent('metadata', 'result', 'jobId'),
      read: torrent('read', 'result', 'request'),
      exportMetainfo: torrent('exportMetainfo', 'result', 'jobId'),
      saveFile: torrent('saveFile', 'result', 'jobId', 'fileIndex'),
      openFile: torrent('openFile', 'result', 'jobId', 'fileIndex'),
      cancel: torrent('cancel', 'result', 'requestId'),
      update: torrent('update', 'result', 'request'),
    },
    events: ['torrent.state', 'torrent.progress', 'torrent.error'],
    handlers: { onState: ['torrent.state'], onProgress: ['torrent.progress'], onError: ['torrent.error'] },
  },
  nzb: {
    methods: {
      downloaders: nzb('downloaders'),
      add: nzb('add', 'request'),
      jobs: nzb('jobs', 'request'),
      status: nzb('status', 'jobId'),
      control: nzb('control', 'request'),
      files: nzb('files', 'request'),
      read: nzb('read', 'request'),
    },
  },
  soulseek: {
    methods: {
      info: soulseek('info'),
      search: soulseek('search', 'request'),
      browse: soulseek('browse', 'username'),
      results: soulseek('results', 'queryId', 'after', 'limit'),
      stop: soulseek('stop', 'queryId'),
      download: soulseek('download', 'fileId'),
      transfers: soulseek('transfers'),
      status: soulseek('status', 'transferId'),
      pause: soulseek('pause', 'transferId'),
      resume: soulseek('resume', 'transferId'),
      cancel: soulseek('cancel', 'transferId'),
      read: soulseek('read', 'transferId', 'offset', 'length'),
      save: soulseek('save', 'transferId'),
      release: soulseek('release', 'kind', 'handle'),
    },
  },
});

