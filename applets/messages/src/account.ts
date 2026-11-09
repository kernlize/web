import { IDENTITY_DOMAIN } from '@napplet/sdk';
import { runtimeHasDomain } from './domain-availability.js';
import { failureReason } from './send-errors.js';
import { readAccount, readStatus } from './shell.js';

export interface Account {
  phase: 'ready' | 'unavailable' | 'signed-out';
  /** Whose messages these are; empty when the shell does not say. */
  owner: string;
}

/** The signed-in account, or null when the shell cannot be asked. */
async function signedIn(): Promise<string | null> {
  if (!runtimeHasDomain(IDENTITY_DOMAIN)) return null;
  try {
    return await readAccount();
  } catch {
    return null;
  }
}

/**
 * Who owns the messages, and whether there is anything to show.
 *
 * The owner is whoever the message status names. A shell's signed-in account
 * can differ from it (a preview shows someone else's messages), so the account
 * is asked for only when the status names nobody, and then mainly to tell
 * "signed out" from "not available". That also keeps startup to one request
 * here in the usual case.
 */
export async function resolveAccount(): Promise<Account> {
  let available = false;
  try {
    const status = await readStatus();
    available = status.available;
    if (available && status.ownerPubkey) return { phase: 'ready', owner: status.ownerPubkey };
  } catch (error) {
    if (/not signed in/i.test(failureReason(error))) return { phase: 'signed-out', owner: '' };
  }
  const account = await signedIn();
  if (account === '') return { phase: 'signed-out', owner: '' };
  return available ? { phase: 'ready', owner: account ?? '' } : { phase: 'unavailable', owner: '' };
}
