import { renderNappletNamespacePrelude, type NappletNamespacePreludeOptions } from '@kehto/shell';

/**
 * One operation of a domain, as the applet calls it and as it travels: the request type,
 * the wire fields its arguments fill in order, and the field of the result it resolves with.
 *
 * The shape is `NappletBindingMethod` from kehto/web#413, declared here until a released
 * `@kehto/shell` exports it.
 */
export interface DomainBindingMethod {
  readonly type: string;
  readonly params: readonly string[];
  readonly reply: boolean;
  readonly result?: string;
}

/** What `window.napplet.<domain>` offers an applet: its operations and the messages the shell may push. */
export interface DomainBinding {
  readonly methods: Readonly<Record<string, DomainBindingMethod>>;
  readonly events?: readonly string[];
  readonly handlers?: Readonly<Record<string, readonly string[]>>;
}

/** Prelude options with the `bindings` kehto/web#413 adds; an older `@kehto/shell` ignores the field. */
export type BoundPreludeOptions = NappletNamespacePreludeOptions & { readonly bindings?: Readonly<Record<string, DomainBinding>> };

const call = (type: string, result: string, ...params: string[]): DomainBindingMethod => ({ type, params, reply: true, result });

const torrent = (action: string, result: string, ...params: string[]): DomainBindingMethod => call(`torrent.${action}`, result, ...params);
const nzb = (action: string, ...params: string[]): DomainBindingMethod => call(`nzb.${action}`, 'result', ...params);
const soulseek = (action: string, ...params: string[]): DomainBindingMethod => call(`soulseek.${action}`, 'value', ...params);

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

const PROBE: BoundPreludeOptions = { domains: ['probe'], bindings: { probe: { methods: { ask: call('probe.ask', 'answer') } } } };

/**
 * Whether the installed `@kehto/shell` can give an applet a domain it does not build in.
 *
 * An applet reaches the shell only through the port kehto's prelude keeps to itself, so a
 * domain kehto does not know is an empty object inside the applet unless the prelude is
 * given its binding table (kehto/web#413). kernl offers the download domains only when
 * this is true: a domain an applet can see but not call would be a promise the shell
 * cannot keep.
 *
 * @param render - The prelude renderer; kehto's by default.
 * @returns True when a binding passed to the prelude reaches its output.
 * @example
 * ```ts
 * supportsDomainBindings(); // false on @kehto/shell 0.35, true once it renders bindings
 * ```
 */
export function supportsDomainBindings(render: (options: NappletNamespacePreludeOptions) => string = renderNappletNamespacePrelude): boolean {
  return render(PROBE).includes('probe.ask');
}
