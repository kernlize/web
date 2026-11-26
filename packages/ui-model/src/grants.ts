import { MESSAGE_COMPANION_DOMAINS, sealsApplet } from '@kernlize/kernel/seal';

/** Plain words for every domain the shell can offer (D-006). */
const LABELS: Readonly<Record<string, string>> = {
  shell: 'the shell',
  inc: 'talking to other applets',
  relay: 'network',
  outbox: 'posting to your network',
  identity: 'your identity',
  storage: 'its own storage',
  cache: 'saved copies',
  theme: 'your theme',
  config: 'its settings',
  resource: 'web fetches',
  link: 'opening links',
  dm: 'messages',
  notify: 'notifications',
  media: 'media controls',
  upload: 'uploads',
  intent: 'opening other applets',
  keys: 'keyboard shortcuts',
  gamepad: 'controllers',
  fs: 'your files',
  llm: 'language models',
  cvm: 'remote tools',
  webrtc: 'direct connections',
  count: 'counting',
  lists: 'your lists',
  common: 'social actions',
  torrent: 'peer sharing',
  nzb: 'news archives',
  soulseek: 'shared libraries',
};

/**
 * What a withheld row says under its label, in the launcher and in the grants panel (D-046).
 *
 * @example
 * ```ts
 * WITHHELD_NOTE; // 'off while it can read your messages'
 * ```
 */
export const WITHHELD_NOTE = 'off while it can read your messages';

/**
 * Whether a domain is withheld from an applet given the domains switched on for it: it can read
 * messages, and this domain is not one of the few that cannot send them anywhere (D-046).
 *
 * @param domain - The domain to ask about.
 * @param on - The domains switched on for the applet.
 * @returns True when the domain is withheld.
 * @example
 * ```ts
 * withheldByMessages('upload', ['dm']); // true
 * withheldByMessages('theme', ['dm']); // false
 * ```
 */
export const withheldByMessages = (domain: string, on: readonly string[]): boolean => sealsApplet(on) && !MESSAGE_COMPANION_DOMAINS.includes(domain);

/**
 * What the launcher says for a domain it has no words for: never the wire name.
 *
 * @example
 * ```ts
 * domainLabel('something-new') === UNKNOWN_DOMAIN_LABEL; // true
 * ```
 */
export const UNKNOWN_DOMAIN_LABEL = 'another capability';

/**
 * The contract a grant stands for, as the shell writes it beside the plain words: the NAP domain in
 * capitals (`RESOURCE`, `OUTBOX`). It is an identifier, like an address, so it is the one place the
 * raw name is shown, and only next to words that say what it means (D-057).
 *
 * @param domain - The NAP domain.
 * @returns The domain in capitals.
 * @example
 * ```ts
 * contractName('resource'); // 'RESOURCE'
 * ```
 */
export const contractName = (domain: string): string => domain.toUpperCase();

/**
 * Plain words for a grant domain. Unknown domains get a generic label, never their raw name.
 *
 * @param domain - The NAP domain.
 * @returns The words the shell shows for it.
 * @example
 * ```ts
 * domainLabel('relay'); // 'network'
 * ```
 */
export const domainLabel = (domain: string): string => (Object.hasOwn(LABELS, domain) ? (LABELS[domain] as string) : UNKNOWN_DOMAIN_LABEL);

/** The domain an applet needs to receive requests other applets hand it. */
const RECEIVING_DOMAIN = 'intent';

/** Where a grant row sits: the unsafe combination first, then what the applet requires, what it may use, and anything else a screen offers. */
export type GrantGroupId = 'unsafe' | 'required' | 'optional' | 'other';

/**
 * Small captions that mark where each group starts. They label; they do not divide.
 *
 * @example
 * ```ts
 * GROUP_LABELS.unsafe; // 'Unsafe with messages'
 * ```
 */
export const GROUP_LABELS: Readonly<Record<GrantGroupId, string>> = {
  unsafe: 'Unsafe with messages',
  required: 'Required',
  optional: 'Optional',
  other: 'Not requested',
};

/** One applet a row speaks for, on a screen that covers several applets at once. */
export interface GrantApplet {
  readonly title: string;
  /** This applet cannot start without the domain. */
  readonly required: boolean;
}

/** One switch in the grants list. */
export interface GrantRow {
  readonly domain: string;
  readonly label: string;
  /** Whether the switch shows as on. */
  readonly on: boolean;
  /** Whether the switch cannot be changed now. */
  readonly locked: boolean;
  readonly mixed?: boolean;
  /** One short line under the label, or empty when the group says it all. */
  readonly note: string;
  /** False when this shell has nothing behind the domain, so it can be shown but never switched on. */
  readonly available: boolean;
  readonly baseline: boolean;
  readonly required: boolean;
  /** The applets that asked for this row, when one screen covers a whole stack. */
  readonly applets?: readonly GrantApplet[];
}

/** A captioned run of grant rows. */
export interface GrantGroup {
  readonly id: GrantGroupId;
  readonly label: string;
  readonly rows: readonly GrantRow[];
}

/** What an applet asks for, and what this shell can give. */
export interface GrantInput {
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly baseline: readonly string[];
  /** Every domain the shell can offer; an applet may name ones it cannot. */
  readonly available: readonly string[];
  /** The applet takes requests from other applets, so it needs the intent domain to receive them: it is required. */
  readonly receives?: boolean;
  /** Other domains a screen lets the person grant too, listed after the applet's own. */
  readonly others?: readonly string[];
}

/** What stands for the applet now. */
export interface GrantState {
  readonly granted: readonly string[];
  /** Domains the person kept beside messages. */
  readonly unsafe: readonly string[];
}

/** What the person has switched on or off on the screen. */
export interface GrantChoices {
  /** Domains switched on, other than the ones kept beside messages. */
  readonly on: ReadonlySet<string>;
  /** Unsafe domains switched on: the person's override of the seal (D-046, D-060). */
  readonly kept: ReadonlySet<string>;
}

const names = (input: GrantInput): { required: string[]; optional: string[]; other: string[] } => {
  const required = [...new Set([...input.requires, ...(input.receives ? [RECEIVING_DOMAIN] : [])])];
  const optional = [...new Set(input.optional)].filter((domain) => !required.includes(domain));
  const other = [...new Set(input.others ?? [])].filter((domain) => !required.includes(domain) && !optional.includes(domain));
  return { required, optional, other };
};

/**
 * The switches a person starts from. What was granted shows as on; with `force`, every required
 * domain the shell can offer is on too, as when an applet is about to run.
 *
 * @param input - What the applet asks for.
 * @param state - What stands for it now.
 * @param force - Switch the required domains on.
 * @returns The starting choices.
 * @example
 * ```ts
 * startingChoices({ requires: ['relay'], optional: [], baseline: [], available: ['relay'] }, { granted: [], unsafe: [] }, true).on; // Set { 'relay' }
 * ```
 */
export function startingChoices(input: GrantInput, state: GrantState, force: boolean): GrantChoices {
  const on = new Set(state.granted.filter((domain) => !input.baseline.includes(domain)));
  if (force) for (const domain of names(input).required) if (input.available.includes(domain)) on.add(domain);
  return { on, kept: new Set(state.unsafe) };
}

/**
 * The grants list as groups: required domains on and fixed, optional ones off and free, and, at
 * the top, the required domains an applet that reads messages cannot have beside them (D-046),
 * under a caption that says so. Those are off until the person allows them, one at a time. Domains this shell cannot offer, and
 * optional ones messages withhold, are shown off and fixed.
 *
 * @param input - What the applet asks for.
 * @param choices - What the person has switched.
 * @returns The groups that have rows, in the order they are shown.
 * @example
 * ```ts
 * grantGroups({ requires: ['dm', 'upload'], optional: [], baseline: [], available: ['dm', 'upload'] }, { on: new Set(['dm']), kept: new Set() })[0]?.id; // 'unsafe'
 * ```
 */
export function grantGroups(input: GrantInput, choices: GrantChoices): GrantGroup[] {
  const { required, optional, other } = names(input);
  const isAvailable = (domain: string): boolean => input.baseline.includes(domain) || input.available.includes(domain);
  const sealed = (required.includes('dm') && isAvailable('dm')) || choices.on.has('dm');
  const rows: Record<GrantGroupId, GrantRow[]> = { unsafe: [], required: [], optional: [], other: [] };
  const place = (domain: string, group: Exclude<GrantGroupId, 'unsafe'>): void => {
    const baseline = input.baseline.includes(domain);
    const available = isAvailable(domain);
    const isRequired = required.includes(domain);
    const withheld = sealed && !MESSAGE_COMPANION_DOMAINS.includes(domain);
    const row = { domain, label: domainLabel(domain), available, baseline, required: isRequired };
    if (!available) rows[group].push({ ...row, on: false, locked: true, note: isRequired ? 'needed, and this shell cannot provide it' : 'not available in this shell' });
    else if (withheld && isRequired) rows.unsafe.push({ ...row, on: choices.kept.has(domain), locked: false, note: '' });
    else if (withheld) rows[group].push({ ...row, on: false, locked: true, note: WITHHELD_NOTE });
    else if (baseline) rows[group].push({ ...row, on: true, locked: true, note: 'always on' });
    else rows[group].push({ ...row, on: choices.on.has(domain), locked: isRequired && choices.on.has(domain), note: '' });
  };
  for (const domain of required) place(domain, 'required');
  for (const domain of optional) place(domain, 'optional');
  for (const domain of other) place(domain, 'other');
  return (['unsafe', 'required', 'optional', 'other'] as const).filter((id) => rows[id].length > 0).map((id) => ({ id, label: GROUP_LABELS[id], rows: rows[id] }));
}

/** One grant to make or take back when the person confirms. */
export interface GrantOp {
  readonly kind: 'allow' | 'revoke';
  readonly domain: string;
  /** For an allow: true keeps the domain beside messages, false drops that exception and keeps the grant. */
  readonly unsafe?: boolean;
}

/**
 * What confirming comes to: required and switched-on domains granted, switched-off ones taken
 * back, an allowed unsafe domain kept beside messages and a dropped override dropped. Nothing for what
 * already stands, for a baseline domain, for one this shell cannot offer, or for one messages
 * withhold: leaving that off is not taking it back.
 *
 * @param input - What the applet asks for.
 * @param choices - What the person has switched.
 * @param state - What stands for the applet now.
 * @returns The operations, in the order the rows are shown.
 * @example
 * ```ts
 * grantsToApply({ requires: ['relay'], optional: [], baseline: [], available: ['relay'] }, { on: new Set(['relay']), kept: new Set() }, { granted: [], unsafe: [] }); // [{ kind: 'allow', domain: 'relay' }]
 * ```
 */
export function grantsToApply(input: GrantInput, choices: GrantChoices, state: GrantState): GrantOp[] {
  const ops: GrantOp[] = [];
  for (const group of grantGroups(input, choices)) {
    for (const row of group.rows) {
      const { domain } = row;
      const granted = state.granted.includes(domain);
      const wasKept = state.unsafe.includes(domain);
      if (!row.available) continue;
      if (group.id === 'unsafe') {
        // A baseline domain is never in the granted list, so for it the exception alone is what stands.
        if (row.on && !(wasKept && (granted || row.baseline))) ops.push({ kind: 'allow', domain, unsafe: true });
        else if (!row.on && wasKept) ops.push({ kind: 'allow', domain, unsafe: false });
      } else if (row.baseline) continue;
      else if (row.on && !granted) ops.push({ kind: 'allow', domain });
      else if (!row.on && granted && !row.locked) ops.push({ kind: 'revoke', domain });
    }
  }
  return ops;
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB'];

/**
 * `1.5 MiB` style byte counts for the grants panel.
 *
 * @param bytes - A byte count.
 * @returns The count in binary units.
 * @example
 * ```ts
 * formatBytes(1536); // '1.5 KiB'
 * ```
 */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}
