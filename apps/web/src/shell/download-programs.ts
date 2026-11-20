import type { DownloadConnection, DownloadProgram, DownloadProgramInfo, DownloadSignIn } from '@kernlize/core';

/** The sign-in field names a program can take. */
export type SignInField = DownloadProgramInfo['signIn'][number];

/** What the person has typed for one program. Secrets start empty and, left empty, keep what was saved. */
export interface ProgramDraft {
  readonly url: string;
  readonly username: string;
  readonly password: string;
  readonly apiKey: string;
}

/** Programs grouped by what they do for the person. */
export const PROGRAM_GROUPS: readonly { readonly id: string; readonly title: string; readonly help: string; readonly programs: readonly DownloadProgram[] }[] = [
  { id: 'peers', title: 'From peers', help: 'Peers see the address of the machine running the program.', programs: ['transmission', 'utorrent'] },
  { id: 'archives', title: 'From archives', help: 'Only your news server sees the transfer.', programs: ['nzbget', 'sabnzbd'] },
  { id: 'sharing', title: 'Shared libraries', help: 'Peers see your searches and the address of that machine.', programs: ['slskd'] },
];

const FIELD_LABELS: Readonly<Record<SignInField, string>> = { username: 'Name', password: 'Password', apiKey: 'Key' };
const SECRET_FIELDS: readonly SignInField[] = ['password', 'apiKey'];

/** What a sign-in field is called in the form. */
export const fieldLabel = (field: SignInField): string => FIELD_LABELS[field];

/** Whether a field is a secret: shown as dots, never filled in from what was saved. */
export const isSecretField = (field: SignInField): boolean => SECRET_FIELDS.includes(field);

/** Whether a secret is kept for a field, which is all the form is ever told about it. */
export function hasSecret(saved: DownloadConnection | undefined, field: SignInField): boolean {
  return (field === 'password' && saved?.hasPassword === true) || (field === 'apiKey' && saved?.hasApiKey === true);
}

/** The form for a program as it opens: its saved address and name, and empty secrets. */
export function draftOf(saved: DownloadConnection | undefined): ProgramDraft {
  return { url: saved?.url ?? '', username: saved?.username ?? '', password: '', apiKey: '' };
}

/** What a draft asks the shell to check and keep: only the fields this program takes, and only those typed. */
export function signInOf(draft: ProgramDraft, fields: readonly SignInField[]): DownloadSignIn {
  const typed = (field: SignInField): string | undefined => (fields.includes(field) ? (field === 'username' ? draft.username.trim() : draft[field]) || undefined : undefined);
  const [username, password, apiKey] = [typed('username'), typed('password'), typed('apiKey')];
  return { url: draft.url.trim(), ...(username ? { username } : {}), ...(password ? { password } : {}), ...(apiKey ? { apiKey } : {}) };
}

/** Whether a draft differs from what is saved, so there is something to save. */
export function draftChanged(draft: ProgramDraft, saved: DownloadConnection | undefined): boolean {
  if (!saved) return draft.url.trim() !== '';
  return draft.url.trim() !== saved.url || draft.username.trim() !== (saved.username ?? '') || draft.password !== '' || draft.apiKey !== '';
}

const REASON_WORDS: Readonly<Record<string, string>> = {
  'invalid:address': 'Enter an address, such as localhost:9091.',
  'invalid:scheme': 'The address must start with http:// or https://.',
  'invalid:credentials-in-address': 'Put the name and password in their own fields.',
  'invalid:mixed-content': 'kernl is open over https, so the address must be https too, or on this device.',
  'invalid:sign-in': 'That name, password or key is too long.',
  'invalid:program': 'Set that program up first.',
  'denied:credentials': 'The program refused that sign-in.',
  'denied:secrets': 'The sign-in could not be kept. Nothing was saved.',
  'unavailable:secrets': 'The sign-in could not be kept. Nothing was saved.',
  'unavailable:timeout': 'The program did not answer in time.',
  'unavailable:unreachable': 'No answer. Check the address, the sign-in, and that the program accepts this page.',
  'unavailable:bad-response': 'Something else answered at that address.',
  'unavailable:unsupported': 'This version of the program is too old.',
};

/** A refused or failed connection in plain words. The raw reason is never shown, and no reason carries a secret. */
export function programError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const [code = ''] = message.split(' ');
  return REASON_WORDS[code] ?? 'That did not work. Check the address.';
}

const NOTE_WORDS: Readonly<Record<string, string>> = {
  cleartext: 'Not encrypted: the password can be read on your network.',
  'cleartext-loopback': 'On this device, so nothing leaves it.',
  'page-insecure': 'kernl itself was opened without encryption.',
};

/** What the person should know about an address that works; an unknown note says nothing rather than something raw. */
export function noteWords(note: string): string | undefined {
  return NOTE_WORDS[note];
}

/** How a program's card says where things stand. */
export function programStatus(saved: DownloadConnection | undefined, version: string | undefined, locked = false): string {
  if (!saved) return 'Not set up';
  if (locked) return 'Sign-in locked';
  return version ? `Connected · ${version}` : 'Set up';
}
