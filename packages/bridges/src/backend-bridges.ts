import { listField, optionalField, requireField } from './fields';
import type {
  Bridge,
  BridgeContext,
  BridgeExposure,
  BackendTraits,
  BridgeAvailability,
  BridgeResult,
  Locator,
  MailBackend,
  NzbBackend,
  SoulseekBackend,
  TorrentBackend,
} from './types';

interface BridgeShape {
  readonly id: string;
  readonly label: string;
  readonly schemes: readonly string[];
  readonly exposure: BridgeExposure;
}

type Resolver<B> = (backend: B, locator: Locator, context: BridgeContext) => Promise<BridgeResult>;

function availabilityOf(backend: BackendTraits | undefined): BridgeAvailability {
  if (!backend) return { available: false, reason: 'no-backend' };
  return backend.handoff ? { available: true, handoff: true } : { available: true };
}

function backedBridge<B extends BackendTraits>(shape: BridgeShape, backend: B | undefined, resolve: Resolver<B>): Bridge {
  return {
    ...shape,
    availability: () => availabilityOf(backend),
    resolve: (locator, context) =>
      backend ? resolve(backend, locator, context) : Promise.reject(new Error('unavailable:no-backend')),
  };
}

/**
 * Creates the bridge for magnet links. Peers in a swarm see the user's address and
 * what they fetch, and the transfer is not encrypted.
 *
 * @param backend - The download engine; without one the bridge reports itself unavailable.
 * @returns A bridge with id `torrent` labelled `downloads`.
 * @example
 * ```ts
 * const bridge = createTorrentBridge(engine);
 * const job = await bridge.resolve(parseLocator(magnetLink), { requester: 'shell' });
 * ```
 */
export function createTorrentBridge(backend?: TorrentBackend): Bridge {
  return backedBridge(
    {
      id: 'torrent',
      label: 'downloads',
      schemes: ['magnet'],
      exposure: { revealsAddress: true, encryptedInTransit: false, publicActivity: true },
    },
    backend,
    async (engine, locator, context) => {
      const job = await engine.add(
        requireField(locator, 'infoHash'),
        listField(locator, 'trackers'),
        context,
        optionalField(locator, 'name'),
      );
      return { kind: 'job', id: job.id, label: job.name };
    },
  );
}

/**
 * Creates the bridge for NZB documents. The indexer and news server see the user's
 * address; the transfer is encrypted and not visible to other users.
 *
 * @param backend - The fetch-and-assemble engine; without one the bridge reports itself unavailable.
 * @returns A bridge with id `nzb` labelled `downloads`.
 * @example
 * ```ts
 * const bridge = createNzbBridge(engine);
 * bridge.availability(); // { available: true }
 * ```
 */
export function createNzbBridge(backend?: NzbBackend): Bridge {
  return backedBridge(
    {
      id: 'nzb',
      label: 'downloads',
      schemes: ['nzb'],
      exposure: { revealsAddress: true, encryptedInTransit: true, publicActivity: false },
    },
    backend,
    async (engine, locator, context) => {
      const job = await engine.add(requireField(locator, 'url'), context);
      return { kind: 'job', id: job.id, label: job.name };
    },
  );
}

/**
 * Creates the bridge for files shared by peers. The peer sees the user's address,
 * the transfer is not encrypted, and shared folders are browsable by others.
 *
 * @param backend - The peer download engine; without one the bridge reports itself unavailable.
 * @returns A bridge with id `soulseek` labelled `sharing`.
 * @example
 * ```ts
 * const bridge = createSoulseekBridge();
 * bridge.availability(); // { available: false, reason: 'no-backend' }
 * ```
 */
export function createSoulseekBridge(backend?: SoulseekBackend): Bridge {
  return backedBridge(
    {
      id: 'soulseek',
      label: 'sharing',
      schemes: ['slsk'],
      exposure: { revealsAddress: true, encryptedInTransit: false, publicActivity: true },
    },
    backend,
    async (engine, locator, context) => {
      const job = await engine.download(requireField(locator, 'user'), requireField(locator, 'path'), context);
      return { kind: 'job', id: job.id, label: job.name };
    },
  );
}

/**
 * Creates the bridge for mail addresses. The user's mail provider, not the
 * correspondent, sees the user's address; the connection to it is encrypted.
 *
 * @param backend - The mail client; without one the bridge reports itself unavailable.
 * @returns A bridge with id `mail` labelled `mail`.
 * @example
 * ```ts
 * const bridge = createMailBridge(client);
 * const conversation = await bridge.resolve(parseLocator('mailto:ada@example.com?subject=Hi'), { requester: 'shell' });
 * ```
 */
export function createMailBridge(backend?: MailBackend): Bridge {
  return backedBridge(
    {
      id: 'mail',
      label: 'mail',
      schemes: ['mailto'],
      exposure: { revealsAddress: false, encryptedInTransit: true, publicActivity: false },
    },
    backend,
    async (client, locator, context) => {
      const conversation = await client.open(
        requireField(locator, 'address'),
        optionalField(locator, 'subject'),
        context,
        optionalField(locator, 'body'),
      );
      return { kind: 'conversation', id: conversation.id, participants: listField(locator, 'addresses') };
    },
  );
}
