import type { Kernl } from '@kernlize/core';
import type { ShellDownloads } from './downloads';

/**
 * The part of the composed shell the UI touches. The event store, the pool and
 * the kehto bridge stay inside the core; the preview implements only this.
 */
export type ShellKernl = Omit<Kernl, 'bridge' | 'eventStore' | 'pool'>;

export type {
  AppletHandle,
  AppletIdentity,
  AppletPointer,
  AppletStatus,
  AppletSummary,
  ConsentPrompt,
  ConsentSummary,
  FrameLike,
  GrantRecord,
  Grants,
  GuardFacade,
  KernlHost,
  MountPlan,
  RelayTier,
  RelayTiers,
  Session,
  StorageLike,
} from '@kernlize/core';

/** Where the running shell came from. */
export type BootMode = 'live' | 'preview';

/** A sample applet the preview offers in the launcher. */
export interface SampleApplet {
  readonly address: string;
  readonly title: string;
  readonly blurb: string;
}

export interface Booted {
  readonly kernl: ShellKernl;
  readonly mode: BootMode;
  readonly samples: readonly SampleApplet[];
  /** Downloads from peers: the in-page engine and the user's choice of where links go. */
  readonly downloads: ShellDownloads;
  /** Why the live shell was not used, when it was not. */
  readonly fallbackReason?: string;
}

/** Fits the sample applets without clipping; the window store clamps it to the desktop. */
export const DEFAULT_WINDOW_SIZE = { width: 720, height: 660 } as const;
export const RECENT_KEY = 'kernl:recent:v1';
export const LAYOUT_KEY = 'kernl:layout:v1';

/** Eight characters of an identity, for badges. */
export const shortId = (value: string): string => value.slice(0, 8);

/** `abcd1234…wxyz` for publisher keys and account ids. */
export const abbreviate = (value: string): string => (value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`);
