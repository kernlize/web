/**
 * `@kernlize/modules/people`: the people module on its own, so a host that lists it bundles only what it needs (D-068).
 *
 * @packageDocumentation
 */
export { peopleModule } from '../modules/people.js';
export { PERSON_HINT_TIMEOUT_MS, createPeople, parsePerson, type People, type PeopleOptions, type PersonPointer } from '../people/person.js';
