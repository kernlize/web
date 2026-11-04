import { bytesToHex, kinds, mergeRelaySets, type NostrEvent } from 'applesauce-core/helpers';
import type { ISigner } from 'applesauce-signers';
import {
  ADDRESSABLE_KEY_PACKAGE_KIND,
  GROUP_EVENT_KIND,
  MarmotClient,
  deserializeApplicationData,
  getGroupMemberPubkeys,
  type MarmotGroup,
  type NostrNetworkInterface,
} from '@internet-privacy/marmot-ts';
import type { DmMessage } from '@napplet/core';
import type { StorageLike, RelayTiers } from '../types.js';
import { subscribeWithEose, type ApplesaucePool, type EoseSubscription } from '../applesauce/relay-hooks.js';
import { createSealedGroupStore, type SealedGroupStoreOptions } from './group-storage.js';
import type { InboxRelays } from './inbox-relays.js';

/** The chat convention the group library suggests for text; anything else carried in a group is not a message. */
const CHAT_KIND = 9;

/** Background work that fails leaves the group as it was; the next event or send tries again. */
const ignore = (): undefined => undefined;

/** What a group session shares with the backend that opened it. */
export interface GroupSessionContext {
  readonly pool: ApplesaucePool;
  readonly tiers: RelayTiers;
  readonly storage: StorageLike;
  readonly network: NostrNetworkInterface;
  readonly inboxRelays: InboxRelays;
  /** Register background work so reads can wait for it. */
  readonly track: (work: Promise<unknown>) => void;
  /** File a message the session read or wrote. */
  readonly deliver: (message: DmMessage, participants: readonly string[]) => void;
}

/** One account's group client and the subscriptions that feed it. */
export interface GroupSession {
  readonly self: string;
  /** Resolves once the client has loaded its groups and listens for invitations. */
  readonly ready: Promise<MarmotClient>;
  /** The group with exactly these other members, created and joined by invitation when there is none. */
  groupFor(client: MarmotClient, others: readonly string[]): Promise<MarmotGroup>;
  /** A group this device belongs to; `invalid:unknown-conversation` otherwise. */
  existing(client: MarmotClient, conversationId: string): MarmotGroup;
  close(): void;
}

async function drain(results: AsyncIterable<unknown>): Promise<void> {
  const iterator = results[Symbol.asyncIterator]();
  while (!(await iterator.next()).done);
}

async function openClient(network: NostrNetworkInterface, sealed: SealedGroupStoreOptions): Promise<MarmotClient> {
  const device = createSealedGroupStore<string>(sealed, 'device');
  const clientId = (await device.getItem('client-id')) ?? (await device.setItem('client-id', bytesToHex(crypto.getRandomValues(new Uint8Array(32)))));
  return new MarmotClient({
    signer: sealed.signer,
    network,
    clientId,
    groupStateStore: createSealedGroupStore(sealed, 'groups'),
    keyPackageStore: createSealedGroupStore(sealed, 'key-packages'),
    inviteStore: createSealedGroupStore(sealed, 'invites'),
    lifecycleStore: createSealedGroupStore(sealed, 'lifecycle'),
    ingestStateStore: createSealedGroupStore(sealed, 'ingest'),
  });
}

/**
 * Everyone in a group, the account included, sorted.
 *
 * @param group - A group this device belongs to.
 * @returns Member public keys.
 * @example
 * ```ts
 * membersOf(group); // ['<alice>', '<bob>']
 * ```
 */
export function membersOf(group: MarmotGroup): string[] {
  return getGroupMemberPubkeys(group.state).sort();
}

/**
 * A group's conversation id: its group id in hex.
 *
 * @param group - A group this device belongs to.
 * @returns The id the backend files the group's messages under.
 * @example
 * ```ts
 * groupIdOf(group); // '8f3a…'
 * ```
 */
export function groupIdOf(group: MarmotGroup): string {
  return bytesToHex(group.id);
}

/**
 * Start a group session for one account: open the group library over sealed
 * storage, publish a key package so others can invite the account, follow
 * the group events of every group it belongs to, and join the groups it is
 * invited to as the invitations open. Group events are applied in arrival
 * order, one group at a time, because each one moves the group's secrets on.
 *
 * @param context - Pool, tiers, storage and the backend's hooks.
 * @param self - The account's public key.
 * @param signer - The account's signer; it needs `nip44`.
 * @returns The session; `close` drops its subscriptions.
 * @example
 * ```ts
 * const session = openGroupSession(context, me, signer);
 * const client = await session.ready;
 * const group = await session.groupFor(client, [alice]);
 * ```
 */
export function openGroupSession(context: GroupSessionContext, self: string, signer: ISigner): GroupSession {
  const handles: EoseSubscription[] = [];
  const chains = new Map<string, Promise<void>>();
  let invites: Promise<void> = Promise.resolve();
  let closed = false;
  const groupRelays = (): string[] => mergeRelaySets(context.tiers.get().outbox, context.tiers.get().super);

  const receive = (group: MarmotGroup, data: Uint8Array): void => {
    const rumor = deserializeApplicationData(data);
    if (rumor.kind !== CHAT_KIND) return;
    // The library delivers only other members' messages, and an account is one member, so nothing read here is the user's own.
    const message: DmMessage = { id: rumor.id, conversationId: groupIdOf(group), senderPubkey: rumor.pubkey, createdAt: rumor.created_at, content: rumor.content, status: 'received' };
    context.deliver(message, membersOf(group));
  };

  const watch = (client: MarmotClient, group: MarmotGroup): void => {
    const id = groupIdOf(group);
    group.on('applicationMessage', (data) => receive(group, data));
    const filter = { kinds: [GROUP_EVENT_KIND], '#h': [bytesToHex(group.groupData?.nostrGroupId as Uint8Array)] };
    const handle = subscribeWithEose(context.pool, mergeRelaySets(group.relays), [filter], (item) => {
      if (item === 'EOSE') return;
      const next = (chains.get(id) ?? Promise.resolve()).then(() => drain(client.groups.ingest(id, [item]))).catch(ignore);
      chains.set(id, next);
      context.track(next);
    });
    handles.push(handle);
  };

  const publishKeyPackage = async (client: MarmotClient): Promise<void> => {
    const relays = mergeRelaySets(await context.inboxRelays(self), context.tiers.get().outbox);
    await client.keyPackages.ensurePublished({ relays }).catch(ignore);
  };

  const accept = (client: MarmotClient, event: NostrEvent): void => {
    invites = invites
      .then(async () => {
        if (!(await client.invites.ingestEvent(event))) return;
        await client.invites.decryptGiftWraps();
        for (const welcomeRumor of await client.invites.getUnread()) {
          await client.invites.markAsRead(welcomeRumor.id);
          watch(client, (await client.joinGroupFromWelcome({ welcomeRumor })).group);
          await publishKeyPackage(client);
        }
      })
      .catch(ignore);
    context.track(invites);
  };

  const start = async (): Promise<MarmotClient> => {
    const client = await openClient(context.network, { storage: context.storage, signer, owner: self });
    await publishKeyPackage(client);
    for (const group of await client.groups.loadAll()) watch(client, group);
    const relays = await context.inboxRelays(self);
    if (closed) return client;
    handles.push(
      subscribeWithEose(context.pool, relays, [{ kinds: [kinds.GiftWrap], '#p': [self] }], (item) => {
        if (item !== 'EOSE') accept(client, item);
      }),
    );
    return client;
  };

  const keyPackageOf = async (pubkey: string): Promise<NostrEvent> => {
    const relays = mergeRelaySets(await context.inboxRelays(pubkey), groupRelays());
    const found = await context.network.request(relays, [{ kinds: [ADDRESSABLE_KEY_PACKAGE_KIND], authors: [pubkey] }]);
    const latest = found.sort((a, b) => b.created_at - a.created_at)[0];
    if (!latest) throw new Error('unavailable:recipient-not-ready');
    return latest;
  };

  return {
    self,
    ready: start(),
    async groupFor(client, others) {
      const wanted = [self, ...others].sort().join(':');
      const known = client.groups.loaded.find((group) => membersOf(group).join(':') === wanted);
      if (known) return known;
      const invitees = await Promise.all(others.map(keyPackageOf));
      const group = await client.groups.create('', { relays: groupRelays(), adminPubkeys: [self], invitees });
      watch(client, group);
      return group;
    },
    existing(client, conversationId) {
      const known = client.groups.loaded.find((group) => groupIdOf(group) === conversationId);
      if (!known) throw new Error('invalid:unknown-conversation');
      return known;
    },
    close() {
      closed = true;
      for (const handle of handles) handle.unsubscribe();
    },
  };
}
