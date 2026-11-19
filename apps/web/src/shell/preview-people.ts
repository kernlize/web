import { parsePerson, type People } from '@kernlize/core';

/** The preview's way of finding a person: every form of an identity is read, and nobody is asked, since it is offline. */
export function createPreviewPeople(): People {
  return {
    parse: parsePerson,
    async locate(input) {
      const person = parsePerson(input);
      if (!person) throw new Error('invalid:person');
      return person.pubkey;
    },
  };
}
