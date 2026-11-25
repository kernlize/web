import type { Observable } from 'rxjs';

// The intents contract the kernel's `Intents` and `Kernel.install` name. The intents module implements it (D-068).

/** One advertised convention, as the verified manifest's `z` and `i` tags declared it. */
export interface InstalledContract {
  readonly slug: string;
  readonly convention: string;
  readonly params: readonly string[];
}

/** An applet the user has run, remembered so other applets can hand work to it. */
export interface InstalledApplet {
  readonly catalogId: string;
  /** What the shell resolves to open it again. */
  readonly address: string;
  readonly title: string;
  readonly publisher: string;
  readonly contracts: readonly InstalledContract[];
  readonly installedAt: number;
}

/** The public entries of one kind-31129 event. Private entries in `content` are kept, not read. */
export interface HandlerPreferences {
  readonly archetype: string;
  /** Archetype-wide `a` and `e` references, in tag order. */
  readonly handlers: readonly string[];
  /** Intent-specific `i` references by convention identity, in tag order. */
  readonly intents: Readonly<Record<string, readonly string[]>>;
}

/** The user's handler choices: what this device remembers, and what their account published. */
export interface HandlerDefaults {
  /** This device's default for an archetype. */
  get(archetype: string): string | undefined;
  /** Every default this device remembers, by archetype. */
  all(): Readonly<Record<string, string>>;
  /**
   * Remember a default, or forget it with `undefined`. With `sync` on and an
   * account that can sign, the choice is also published as the user's
   * handler preference for the archetype.
   */
  set(archetype: string, catalogId: string | undefined): Promise<void>;
  /** The account's published preferences for an archetype, once loaded. */
  synced(archetype: string): HandlerPreferences | undefined;
  /** Read the signed-in account's published preferences from its relays. */
  load(): Promise<void>;
  /** Whether choices are published to the account. Off until the user turns it on. */
  readonly sync: boolean;
  setSync(on: boolean): void;
  /** The archetype whose defaults or published preferences just changed. */
  readonly changes$: Observable<string>;
}
