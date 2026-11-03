const LABELS: Readonly<Record<string, string>> = {
  relay: 'network',
  identity: 'your account',
  storage: 'its own storage',
  theme: 'your theme',
  resource: 'web fetches',
  dm: 'messages',
  notify: 'notifications',
  media: 'media controls',
  upload: 'uploads',
  intent: 'opening other applets',
  keys: 'keyboard shortcuts',
  fs: 'your files',
  llm: 'language models',
};

/** Plain words for a grant domain. Unknown domains keep their raw name. */
export const domainLabel = (domain: string): string => LABELS[domain] ?? domain;

export interface DomainChoice {
  readonly domain: string;
  readonly label: string;
  readonly required: boolean;
  readonly baseline: boolean;
  readonly granted: boolean;
}

interface ChoiceInput {
  readonly requires: readonly string[];
  readonly optional: readonly string[];
  readonly baseline: readonly string[];
  readonly granted: readonly string[];
}

/** One row per domain the applet mentions, required first, pre-set to baseline plus earlier grants. */
export function domainChoices(input: ChoiceInput): DomainChoice[] {
  const seen = new Set<string>();
  const rows: DomainChoice[] = [];
  const push = (domain: string, required: boolean): void => {
    if (seen.has(domain)) return;
    seen.add(domain);
    const baseline = input.baseline.includes(domain);
    rows.push({ domain, label: domainLabel(domain), required, baseline, granted: baseline || input.granted.includes(domain) });
  };
  for (const domain of input.requires) push(domain, true);
  for (const domain of input.optional) push(domain, false);
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
