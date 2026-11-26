import type { SampleSpec } from './specs.js';

/** The buttons, and what each one asks for. Pure. */
export interface Action {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  /** The domain the call needs; the button is marked when the shell did not inject it. */
  readonly domain: string;
}

export const ACTIONS: readonly Action[] = [
  { id: 'publish', label: 'Publish a note', hint: 'routine: goes out without a prompt', domain: 'outbox' },
  { id: 'profile', label: 'Update your profile', hint: 'asks you first: it replaces your profile', domain: 'outbox' },
  { id: 'delete', label: 'Delete a note', hint: 'asks you first: it cannot be undone', domain: 'outbox' },
  { id: 'notify', label: 'Send a notification', hint: 'needs the notifications grant', domain: 'notify' },
  { id: 'settings', label: 'Open its settings', hint: 'the shell draws the form; only this applet reads it', domain: 'config' },
  { id: 'intent', label: 'Open a profile', hint: 'another applet shows it; the shell asks which', domain: 'intent' },
  { id: 'flood', label: 'Flood the shell', hint: '40 network reads at once; watch the guard', domain: 'outbox' },
  {
    id: 'download',
    label: 'Download a shared file',
    hint: 'it joins your downloads, or goes to an app on your device if you chose that',
    domain: 'torrent',
  },
  { id: 'link', label: 'Open a link', hint: 'the firewall asks first', domain: 'link' },
];

export const EXTRA_ACTIONS: readonly Action[] = [
  { id: 'contacts', label: 'Replace your contacts', hint: 'asks you first: it replaces who you follow', domain: 'outbox' },
  {
    id: 'servers',
    label: 'Change your inbox and outbox',
    hint: 'asks you first: it replaces your published inbox and outbox',
    domain: 'outbox',
  },
  { id: 'vanish', label: 'Ask to erase your identity', hint: 'asks you first: it cannot be undone', domain: 'outbox' },
];

/** The shared buttons, less settings for a sample that never declares them. */
export function actionsFor(spec: SampleSpec): readonly Action[] {
  const wantsSettings = [...spec.requires, ...spec.optional].includes('config');
  return ACTIONS.filter((action) => wantsSettings || action.domain !== 'config');
}

/** The extra buttons only this sample shows. */
export function extrasFor(spec: SampleSpec): readonly Action[] {
  return EXTRA_ACTIONS.filter((action) => spec.extras.includes(action.id));
}

export interface Draft {
  readonly kind: number;
  readonly content: string;
  readonly tags: string[][];
}

export const SAMPLE_CONTACT = 'decade00'.repeat(8);
export const SAMPLE_NOTE_ID = 'c0ffee00'.repeat(8);
export const SAMPLE_MAGNET = `magnet:?xt=urn:btih:${'ab'.repeat(20)}&dn=Sample`;
export const SAMPLE_LINK = 'https://kernl.run/docs/';
export const DEFAULT_NOTE = 'Hello from a sample applet.';
export const FLOOD_SIZE = 40;

/** What each publishing button asks the shell to sign, and what the change is called in a result line. */
export function draftFor(id: string, note: string): { readonly name: string; readonly draft: Draft } | undefined {
  switch (id) {
    case 'publish':
      return { name: 'Note', draft: { kind: 1, content: note.trim() || DEFAULT_NOTE, tags: [] } };
    case 'profile':
      return { name: 'Profile', draft: { kind: 0, content: JSON.stringify({ name: 'Sample identity' }), tags: [] } };
    case 'delete':
      return { name: 'Deletion', draft: { kind: 5, content: '', tags: [['e', SAMPLE_NOTE_ID]] } };
    case 'contacts':
      return { name: 'Contacts', draft: { kind: 3, content: '', tags: [['p', SAMPLE_CONTACT, 'wss://relay.damus.io', 'alex']] } };
    case 'servers':
      return {
        name: 'Inbox and outbox',
        draft: { kind: 10002, content: '', tags: [['r', 'wss://nos.lol'], ['r', 'wss://relay.damus.io', 'write']] },
      };
    case 'vanish':
      return { name: 'Erase request', draft: { kind: 62, content: 'Please erase everything.', tags: [['relay', 'wss://relay.damus.io']] } };
    default:
      return undefined;
  }
}

/** The settings Notes registers: one of each kind the shell's form draws. Mirrors `PREVIEW_SETTINGS_SCHEMA`. */
export const SETTINGS_SCHEMA = {
  type: 'object',
  properties: {
    signature: { type: 'string', title: 'Signature', description: 'Added under every note.', default: '' },
    size: { type: 'integer', title: 'Text size', minimum: 12, maximum: 24, default: 15, 'x-napplet-section': 'look', 'x-napplet-order': 1 },
    tone: { type: 'string', title: 'Colour tone', enum: ['calm', 'bright'], default: 'calm', 'x-napplet-section': 'look', 'x-napplet-order': 2 },
    compact: { type: 'boolean', title: 'Compact list', default: false, 'x-napplet-section': 'look' },
    token: {
      type: 'string',
      title: 'Sync token',
      description: 'Kept by the shell; never shown again.',
      'x-napplet-secret': true,
      'x-napplet-section': 'sync',
    },
  },
} as const;

/** Keys whose values are never echoed, only said to be set. */
export const SECRET_SETTINGS: ReadonlySet<string> = new Set(['token']);
