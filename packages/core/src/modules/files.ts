import { Subject, takeUntil } from 'rxjs';
import { createUploadService } from '@kehto/services';
import { lookupRelaysOf } from '../applesauce/identity-providers.js';
import { createAccountFileServers, type AccountFileServers } from '../files/file-servers.js';
import { createBlossomUploader, askUploadConsent } from '../files/uploader.js';
import type { KernlModule } from './module.js';

/**
 * The person's file servers and the `upload` domain (D-033): `kernl.files`. An applet's upload asks
 * the person about each file, in that applet's name, before anything leaves; the shell then signs
 * the servers' authorisation with the active signer (D-065), as it signs the person's own save of
 * the list. Without this module the `upload` domain is not offered and `kernl.files` is absent.
 *
 * @returns The module; its api is `AccountFileServers`.
 * @example
 * ```ts
 * const kernl = createKernl({ host, modules: [filesModule()] });
 * await kernl.files.save(['https://blossom.example']);
 * ```
 */
export function filesModule(): KernlModule<'files', AccountFileServers> {
  return {
    id: 'files',
    asks: ['upload.file'],
    setup(context) {
      const stopped$ = new Subject<void>();
      const files = createAccountFileServers({
        store: context.eventStore,
        pool: context.pool,
        load: context.replaceableLoader,
        pubkey$: context.identity.pubkey$.pipe(takeUntil(stopped$)),
        pubkey: () => context.identity.pubkey(),
        lookupRelays: () => lookupRelaysOf(context.tiers.get()),
        outboxes: () => context.tiers.get().outbox,
        signer: () => context.signer(),
      });
      const uploader = createBlossomUploader({
        servers: () => files.current(),
        signer: () => context.signer(),
        ask: (windowId, details) => askUploadConsent({ ask: context.ask, has: context.canAsk }, context.appletOf(windowId)?.identity, details, windowId),
      });
      return {
        services: { upload: createUploadService({ uploader, uploadInfo: { rails: [{ rail: 'blossom', enabled: true }] } }) },
        api: files,
        dispose: () => stopped$.next(),
      };
    },
  };
}
