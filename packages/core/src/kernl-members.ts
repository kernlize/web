import type { MessagingRegistry } from '@kernlize/messaging';
import type { BridgeRegistry } from '@kernlize/bridges';
import type { DownloadClients } from './downloads/download-clients.js';
import type { Profiles } from './profiles/profiles.js';
import type { People } from './people/person.js';
import type { AccountMailboxes } from './relays/mailboxes.js';
import type { AccountFileServers } from './files/file-servers.js';
import type { RelayDirectory } from './relays/directory.js';
import type { AppletCatalog, Intents, Kernel, KernlMultiplayer } from './types.js';

/** The members of the shell that kernl's own modules provide, by module id (D-062). Each is present when its module is loaded. */
export interface KernlMembers {
  /** The person's messaging providers, their order and their reply rule (D-016, D-018). */
  readonly messaging: MessagingRegistry;
  readonly bridges: BridgeRegistry;
  readonly catalog: AppletCatalog;
  /** People's names and pictures, loaded from their profiles on demand. */
  readonly profiles: Profiles;
  /** Finds a person from hex, `npub` or `nprofile`, asking the servers an `nprofile` names. */
  readonly people: People;
  /** The signed-in account's published inbox and outbox (NIP-65); the `outbox` tier follows its outboxes. */
  readonly mailboxes: AccountMailboxes;
  /** Where the account's uploads go (BUD-03, kind 10063); the defaults while it has no list. */
  readonly files: AccountFileServers;
  /** The person's servers, helpers and trusted tool families for meeting people and calling remote tools (D-043). */
  readonly multiplayer: KernlMultiplayer;
  /** The download programs the person set up on this device, and the check an address goes through before it is kept (D-050). */
  readonly downloads: DownloadClients;
  /** Monitored servers (NIP-66) for completing and suggesting; idle until `start()`. */
  readonly directory: RelayDirectory;
  readonly intents: Intents;
}

/** The ids of the members modules provide. */
export type ModuleMembers = keyof KernlMembers;

/** The composed shell with kernl's own modules: the kernel and every member they provide. One per page. */
export type Kernl = Kernel & KernlMembers;
