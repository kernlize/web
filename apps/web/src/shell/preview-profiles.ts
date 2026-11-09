import { of } from 'rxjs';
import type { ProfileCard, Profiles } from '@kernlize/core';
import { abbreviate } from './contract';

/**
 * The preview's people: a fixed set of names, because the preview reaches nobody.
 * A key outside the set reads as its abbreviation, exactly as the live shell shows
 * a key whose profile has not arrived.
 */
export function createPreviewProfiles(names: Readonly<Record<string, string>>): Profiles {
  const card = (pubkey: string): ProfileCard => {
    const name = names[pubkey.toLowerCase()];
    return Object.freeze(name === undefined ? { pubkey, name: abbreviate(pubkey), found: false } : { pubkey, name, found: true });
  };
  return { card, card$: (pubkey) => of(card(pubkey)) };
}
