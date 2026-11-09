import type { IntentAvailability, IntentDispatchParams, IntentResult } from '@kehto/services';
import {
  catalogIdForRef,
  createInstalledApplets,
  refForCatalogId,
  type HandlerChoice,
  type HandlerDefaults,
  type HandlerPreferences,
  type HandlerPrompt,
  type InstallableApplet,
  type InstalledApplets,
  type IntentRouter,
} from '@kernlize/core';
import type { EventTemplate, NappletMessage, NostrEvent } from '@napplet/core';
import { scratch, sha256Hex, type CoreWorld } from './world.js';

/** Publisher of every applet these steps install. */
export const PUB = 'c'.repeat(64);

/** `named:viewer` is a named applet, `snapshot:pinned` a pinned version, `root` a root applet; anything else is taken literally. */
export function refOf(notation: string): string {
  if (notation.startsWith('named:')) return `35129:${PUB}:${notation.slice(6)}`;
  if (notation.startsWith('snapshot:')) return sha256Hex(notation.slice(9));
  return notation === 'root' ? `15129:${PUB}:` : notation;
}

export const idOfNotation = (notation: string): string => catalogIdForRef(refOf(notation)) ?? notation;

export function notationOf(id: string): string {
  const ref = refForCatalogId(id) ?? id;
  if (ref.startsWith(`35129:${PUB}:`)) return `named:${ref.slice(`35129:${PUB}:`.length)}`;
  if (ref === `15129:${PUB}:`) return 'root';
  return ['pinned', 'old'].find((name) => sha256Hex(name) === ref) ? `snapshot:${['pinned', 'old'].find((name) => sha256Hex(name) === ref)}` : ref;
}

/** Applets in router and delivery steps are named applets of the test publisher. */
export const appletId = (name: string): string => `nip5d:35129:${PUB}:${name}`;
export const nameOf = (id: string): string => id.slice(appletId('').length);
export const titleOf = (name: string): string => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

export interface Contract {
  slug: string;
  convention: string;
  params: string[];
}

export function summaryFor(name: string, contracts: readonly Contract[]): InstallableApplet {
  return { address: `naddr-${name}`, title: titleOf(name), publisher: PUB, manifest: { catalogId: appletId(name), archetypes: contracts.map((contract) => ({ ...contract })) } };
}

/** `profile/open+profile/edit` is two conventions for the role `profile`. */
export function contractsOf(spec: string): Contract[] {
  return spec === ''
    ? []
    : spec.split('+').map((part) => {
        const [slug = ''] = part.split('/');
        return { slug, convention: `napplet:${part}`, params: ['pubkey'] };
      });
}

export interface IntentScratch {
  clock: number;
  installed: InstalledApplets;
  preference?: NostrEvent;
  written?: EventTemplate | undefined;
  account: { pubkey: string | undefined; canSign: boolean };
  defaults?: HandlerDefaults;
  heard: string[];
  router?: IntentRouter;
  sender: string;
  choose?: ((prompt: HandlerPrompt) => Promise<HandlerChoice | undefined>) | undefined;
  prompts: HandlerPrompt[];
  synced: Map<string, HandlerPreferences>;
  local: Map<string, string>;
  failSaves: boolean;
  delivered: IntentDispatchParams[];
  result?: IntentResult;
  availability?: IntentAvailability;
  changes: IntentAvailability[];
  deliver?: (params: IntentDispatchParams) => Promise<void>;
  running: Map<string, string>;
  opensAs: string | undefined;
  opened: string[];
  focused: string[];
  sent: Array<{ windowId: string; message: NappletMessage }>;
  tries: Map<string, number>;
  readyAfter: Map<string, number>;
  never: Set<string>;
  failure?: Error;
  withFocus: boolean;
}

export function i(world: CoreWorld): IntentScratch {
  const store = scratch(world);
  store.intents ??= {
    clock: 1000,
    installed: createInstalledApplets(store.storage, () => (store.intents as IntentScratch).clock),
    account: { pubkey: undefined, canSign: false },
    heard: [],
    sender: appletId('notes'),
    prompts: [],
    synced: new Map(),
    local: new Map(),
    failSaves: false,
    delivered: [],
    changes: [],
    running: new Map(),
    opensAs: undefined,
    opened: [],
    focused: [],
    sent: [],
    tries: new Map(),
    readyAfter: new Map(),
    never: new Set(),
    withFocus: true,
  } satisfies IntentScratch;
  return store.intents as IntentScratch;
}

