/** Plain words for every domain the shell can offer (D-006). */
const LABELS: Readonly<Record<string, string>> = {
  shell: 'the shell',
  inc: 'talking to other applets',
  relay: 'network',
  outbox: 'posting to your network',
  identity: 'your account',
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
  fs: 'your files',
  llm: 'language models',
  cvm: 'remote tools',
  count: 'counting',
  lists: 'your lists',
  common: 'social actions',
};

/** What the launcher says for a domain it has no words for: never the wire name. */
export const UNKNOWN_DOMAIN_LABEL = 'another capability';

/** Plain words for a grant domain. Unknown domains get a generic label, never their raw name. */
export const domainLabel = (domain: string): string => (Object.hasOwn(LABELS, domain) ? (LABELS[domain] as string) : UNKNOWN_DOMAIN_LABEL);

/** Domains that are switched on the first time an applet that requires them is opened. */
const PRESET_WHEN_REQUIRED: ReadonlySet<string> = new Set(['identity', 'intent']);

/** The domain an applet needs to receive requests other applets hand it. */
const RECEIVING_DOMAIN = 'intent';

export interface DomainChoice {
  readonly domain: string;
  readonly label: string;
  readonly required: boolean;
  readonly baseline: boolean;
  readonly granted: boolean;
  /** Switched on before the user decides: a required account grant on an applet's first run. */
  readonly preset: boolean;
}

interface ChoiceInput {
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly baseline: readonly string[];
  readonly granted: readonly string[];
  /** True when the user has never decided anything for this applet. */
  readonly firstRun: boolean;
  /** The applet takes requests from other applets, so it needs the intent domain to receive them. */
  readonly receives?: boolean;
}

/**
 * One row per domain the applet mentions, required first, pre-set to baseline plus earlier grants.
 * Your account and opening other applets are grants, not baseline; an applet that requires one gets
 * the switch on at first run. An applet that takes requests from other applets gets the intent row
 * even when its manifest did not list it, switched on at first run, because without it nothing reaches it.
 */
export function domainChoices(input: ChoiceInput): DomainChoice[] {
  const seen = new Set<string>();
  const rows: DomainChoice[] = [];
  const push = (domain: string, required: boolean, presetAlways = false): void => {
    if (seen.has(domain)) return;
    seen.add(domain);
    const baseline = input.baseline.includes(domain);
    const preset = input.firstRun && (presetAlways || (required && PRESET_WHEN_REQUIRED.has(domain)));
    rows.push({ domain, label: domainLabel(domain), required, baseline, granted: baseline || input.granted.includes(domain), preset });
  };
  for (const domain of input.requires) push(domain, true, input.receives === true && domain === RECEIVING_DOMAIN);
  for (const domain of input.optional) push(domain, false, input.receives === true && domain === RECEIVING_DOMAIN);
  if (input.receives) push(RECEIVING_DOMAIN, false, true);
  return rows;
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB'];

/** `1.5 MiB` style byte counts for the grants panel. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${UNITS[unit]}`;
}
