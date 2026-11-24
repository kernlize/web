import { Actions, computeBlobSha256, createUploadAuth, type BlobDescriptor, type SignedEvent } from 'blossom-client-sdk';
import type { Uploader, UploadRequest, UploadResult } from '@kehto/services';
import type { ISigner } from 'applesauce-signers';
import type { NostrEvent } from '@napplet/core';
import type { AppletIdentity, ConsentSummary } from '../types.js';
import { toAskChannel, type AskChannel, type AskHost } from '../asks/channel.js';
import type { UploadDetails } from '../asks/facts.js';

export type { UploadDetails } from '../asks/facts.js';


/** Uploads to several servers, the first first and the rest as mirrors; hzrd149's `multiServerUpload` fits. */
export type MultiServerUpload = (
  servers: readonly string[],
  blob: Blob,
  options: {
    onAuth: (server: string, sha256: string, type: 'upload' | 'media') => Promise<SignedEvent>;
    onUpload: (server: string) => void;
    onError: (server: string, sha256: string, blob: Blob, error: Error) => void;
  },
) => Promise<Map<string, BlobDescriptor>>;

/** Options for {@link createBlossomUploader}. */
export interface BlossomUploaderOptions {
  /** The servers this upload goes to, in order. */
  readonly servers: () => Promise<readonly string[]>;
  readonly signer: () => Pick<ISigner, 'signEvent' | 'getPublicKey'> | undefined;
  /** Asks the person; resolves true only when they allow it. Called once per upload, before anything is signed or sent. */
  readonly ask: (windowId: string, details: UploadDetails) => Promise<boolean>;
  /** The transfer; hzrd149's `Actions.multiServerUpload` by default. */
  readonly transfer?: MultiServerUpload;
}

const KIB = 1024;

/**
 * A size as a person reads it.
 *
 * @param bytes - A byte count.
 * @returns `512 bytes`, `1.5 KB`, `3.2 MB`.
 * @example
 * ```ts
 * sizeWords(1_572_864); // '1.5 MB'
 * ```
 */
export function sizeWords(bytes: number): string {
  if (bytes < KIB) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / KIB;
  let unit = 0;
  while (value >= KIB && unit < units.length - 1) {
    value /= KIB;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * The consent prompt for an upload: what leaves, how big it is, where it goes
 * and who can then fetch it. A file on a public server can be fetched by
 * anyone who has its address, so the prompt says so plainly.
 *
 * @param details - The file and its servers.
 * @param applet - The applet asking.
 * @returns The summary the host renders.
 * @example
 * ```ts
 * describeUpload({ mimeType: 'image/png', size: 2048, sha256, servers }, identity).title; // 'Upload a file'
 * ```
 */
export function describeUpload(details: UploadDetails, applet: AppletIdentity): ConsentSummary {
  const hosts = details.servers.map((server) => new URL(server).hostname);
  const draft: NostrEvent = {
    kind: 24242,
    content: 'Upload a file',
    tags: [['t', 'upload'], ['x', details.sha256]],
    created_at: 0,
    pubkey: '',
    id: '',
    sig: '',
  };
  return {
    title: 'Upload a file',
    severity: 'public',
    lines: [
      { label: 'File', after: `${details.filename ? `${details.filename}, ` : ''}${details.mimeType}` },
      { label: 'Size', after: sizeWords(details.size) },
      { label: 'Sent to', after: hosts.join(', ') },
      { label: 'Who can see it', after: 'Anyone who has its address' },
    ],
    applet,
    event: draft,
  };
}

/**
 * Put an upload to the person as an `upload.file` ask: the file's name, type, size, hash and
 * servers, and kernl's summary of them. An applet the shell cannot name is refused without asking.
 *
 * @param host - The host whose renderer draws `upload.file`, or an ask channel.
 * @param applet - The asking applet's identity, if the shell knows it.
 * @param details - The file and its servers.
 * @param windowId - The window that asked, whose answer it is.
 * @returns Whether the person allowed it.
 * @example
 * ```ts
 * ask: (windowId, details) => askUploadConsent(host, identityOf(windowId), details, windowId);
 * ```
 */
export function askUploadConsent(host: AskHost | AskChannel, applet: AppletIdentity | undefined, details: UploadDetails, windowId?: string): Promise<boolean> {
  if (!applet) return Promise.resolve(false);
  return toAskChannel(host).ask({ kind: 'upload.file', ...(windowId === undefined ? {} : { windowId }), applet, facts: details, defaultText: describeUpload(details, applet) });
}

const asBlob = (request: UploadRequest): Blob => (request.data instanceof Blob ? request.data : new Blob([request.data], request.mimeType ? { type: request.mimeType } : {}));

function failed(uploadId: string, error: string, status: 'failed' | 'cancelled' = 'failed'): UploadResult {
  return { ok: false, uploadId, status, rail: 'blossom', error };
}

function completed(uploadId: string, stored: readonly BlobDescriptor[], mimeType: string): UploadResult {
  const [first, ...rest] = stored as [BlobDescriptor, ...BlobDescriptor[]];
  const type = first.type ?? mimeType;
  return {
    ok: true,
    uploadId,
    status: 'complete',
    rail: 'blossom',
    url: first.url,
    ...(rest.length ? { fallbackUrls: rest.map((descriptor) => descriptor.url) } : {}),
    sha256: first.sha256,
    size: first.size,
    mimeType: type,
    nip94: [['url', first.url], ['x', first.sha256], ['m', type], ['size', String(first.size)], ...rest.map((descriptor) => ['fallback', descriptor.url])],
  };
}

/**
 * kernl's upload backend for kehto's `createUploadService`: Blossom over
 * hzrd149's client SDK. The file goes to the account's first file server and
 * is mirrored to the others; any server that stores it makes the upload a
 * success, and the result names every copy (D-028). The person is asked first,
 * once per file, with what it is, its size and where it goes; nothing is signed
 * or sent unless they allow it. A read-only session cannot upload. An applet
 * never chooses the servers (D-033).
 *
 * @param options - Servers, signer, the consent question and an optional transfer for tests.
 * @returns An `Uploader`.
 * @example
 * ```ts
 * registry.upload = createUploadService({ uploader: createBlossomUploader({ servers: files.current, signer, ask }) });
 * ```
 */
export function createBlossomUploader(options: BlossomUploaderOptions): Uploader {
  const transfer: MultiServerUpload = options.transfer ?? Actions.multiServerUpload;
  return {
    // Under the firewall kehto has the destination approved before any byte leaves. The plan names the
    // first file server, where the file goes first; the mirrors are the person's own list (D-033).
    async planUpload(request, ctx) {
      const signer = options.signer();
      if (!signer) throw new Error('denied:read-only');
      const [destination] = await options.servers();
      if (destination === undefined) throw new Error('unavailable:no-file-server');
      return { rail: 'blossom', destination, signingPubkey: await signer.getPublicKey(), execute: () => this.upload(request, ctx) };
    },
    async upload(request, ctx) {
      const signer = options.signer();
      if (!signer) return failed(ctx.uploadId, 'denied:read-only');
      const blob = asBlob(request);
      const servers = await options.servers();
      if (servers.length === 0) return failed(ctx.uploadId, 'unavailable:no-file-server');
      const sha256 = await computeBlobSha256(blob);
      const mimeType = blob.type || 'application/octet-stream';
      const details: UploadDetails = { mimeType, size: blob.size, sha256, servers, ...(request.filename ? { filename: request.filename } : {}) };
      if (!(await options.ask(ctx.windowId, details))) return failed(ctx.uploadId, 'denied:consent', 'cancelled');
      let auth: Promise<SignedEvent> | undefined;
      const signEvent = (draft: Parameters<ISigner['signEvent']>[0]): Promise<SignedEvent> => signer.signEvent(draft) as Promise<SignedEvent>;
      const stored = await transfer(servers, blob, {
        // One authorization covers the file on every server, so the signer is asked once.
        onAuth: (_server, hash) => (auth ??= createUploadAuth(signEvent, hash)),
        onUpload: () => {
          ctx.onStatus({ ok: true, uploadId: ctx.uploadId, status: 'uploading', rail: 'blossom', bytesSent: blob.size, bytesTotal: blob.size, updatedAt: Date.now() });
        },
        onError: () => undefined,
      }).catch(() => new Map<string, BlobDescriptor>());
      if (stored.size === 0) return failed(ctx.uploadId, `unavailable:not-accepted:0/${servers.length}`);
      return completed(ctx.uploadId, servers.flatMap((server) => stored.get(server) ?? []), mimeType);
    },
  };
}
