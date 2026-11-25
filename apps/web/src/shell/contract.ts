import type { Kernl } from '@kernlize/core';
import type { ShellDownloads } from './downloads';
import type { ShellTheme } from './shell-theme';

/**
 * The part of the composed shell the UI touches. The event store, the pool and
 * the kehto bridge stay inside the core; the preview implements only this.
 *
 * `theme` is the theme module's api, which every mode offers: the live shell's
 * `themeModule`, and the preview's own ports. The window manager tells it the
 * page's colours changed, so the applets that are open follow them (D-064).
 */
export type ShellKernl = Omit<Kernl, 'bridge' | 'eventStore' | 'pool'> & { readonly theme: { publish(theme: ShellTheme): void } };

export type {
  Ask,
  AskChannel,
  AskRenderers,
  AppletHandle,
  AppletMessage,
  AppletStopDetails,
  AppletStopLimit,
  AppletIdentity,
  AppletPointer,
  AppletStatus,
  AppletCatalog,
  AppletStack,
  AppletStacks,
  AppletSummary,
  BuiltinApplet,
  CatalogEntry,
  ConsentPrompt,
  ConsentSummary,
  Firewall,
  FirewallChoice,
  FirewallDecision,
  FirewallPrompt,
  FirewallRequest,
  FirewallRuleTarget,
  FirewallSummary,
  FrameLike,
  GrantRecord,
  Grants,
  GuardFacade,
  HandlerChoice,
  HandlerOption,
  HandlerPrompt,
  InstalledApplet,
  Intents,
  KernlHost,
  MountPlan,
  RelayTier,
  RelayTiers,
  Session,
  SettingsPrompt,
  ShortcutKey,
  StackMember,
  StorageLike,
} from '@kernlize/core';

/** Where the running shell came from. */
export type BootMode = 'live' | 'preview';

export interface Booted {
  readonly kernl: ShellKernl;
  readonly mode: BootMode;
  /** Downloads from peers: the in-page engine and the user's choice of where links go. */
  readonly downloads: ShellDownloads;
  /** Why the live shell was not used, when it was not. */
  readonly fallbackReason?: string;
}

/** Fits most applets without clipping; the window manager clamps it to the desktop. */
export const DEFAULT_WINDOW_SIZE = { w: 720, h: 660 } as const;
export const RECENT_KEY = 'kernl:recent:v1';
export const LAYOUT_KEY = 'kernl:layout:v1';
/** Whether running an applet remembers the grants the person chose; on unless they turned it off (D-060). */
export const REMEMBER_GRANTS_KEY = 'kernl:remember-grants:v1';

/** Eight characters of an identity, for badges. */
export const shortId = (value: string): string => value.slice(0, 8);

/** `abcd1234…wxyz` for publisher keys and account ids. */
export const abbreviate = (value: string): string => (value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-4)}`);

/**
 * Who an applet is from, for the lines that say so. One that came with the shell has no publisher
 * to name: its address is under the shell's own scheme, and the key it carries is a placeholder.
 */
export const isBuiltInApplet = (address: string): boolean => address.startsWith('kernl:');

/** {@link Publisher}'s words before a profile is known, for text that cannot hold a component. */
export const publisherWords = (applet: { readonly address: string; readonly publisher: string }): string =>
  isBuiltInApplet(applet.address) ? 'comes with kernl' : `by ${abbreviate(applet.publisher)}`;
